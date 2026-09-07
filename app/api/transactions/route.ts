import { validateAttachment } from "@/lib/attachments";
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

/**
 * GET /api/transactions
 * 获取交易记录列表（带筛选和统计）
 * 查询参数：
 * - type: 交易类型 'income' 或 'expense'，默认返回全部
 * - categoryId: 分类ID，默认返回所有分类
 * - memberId: 成员ID，默认返回所有成员
 * - startDate: 开始日期，格式：YYYY-MM-DD
 * - endDate: 结束日期，格式：YYYY-MM-DD
 * - q: 备注关键词（忽略大小写，按字面匹配）
 */
export async function GET(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }

    // 获取查询参数
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type'); // 'income' | 'expense' | null
    const categoryId = searchParams.get('categoryId');
    const memberId = searchParams.get('memberId');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const q = searchParams.get('q')?.trim() || '';
    const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(value))
      && new Date(value).toISOString().slice(0, 10) === value;
    if ((startDate && !validDate(startDate)) || (endDate && !validDate(endDate))) {
      return NextResponse.json({ error: '日期格式无效，请使用 YYYY-MM-DD' }, { status: 400 });
    }
    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json({ error: '开始日期不能晚于结束日期' }, { status: 400 });
    }

    // 列表与摘要共用同一组条件，备注搜索按字面子串匹配。
    const params: unknown[] = [session.userId];
    const conditions = ['t.user_id = $1'];
    const addCondition = (expression: string, value: unknown) => {
      params.push(value);
      conditions.push(expression.replace('?', `$${params.length}`));
    };
    if (type === 'income' || type === 'expense') addCondition('t.type = ?', type);
    if (categoryId === 'none') conditions.push('t.category_id IS NULL');
    else if (categoryId) addCondition('t.category_id = ?', categoryId);
    if (memberId === 'none') conditions.push('t.member_id IS NULL');
    else if (memberId) addCondition('t.member_id = ?', memberId);
    if (startDate) addCondition('t.transaction_date >= ?::date', startDate);
    if (endDate) addCondition("t.transaction_date < (?::date + INTERVAL '1 day')", endDate);
    if (q) addCondition("STRPOS(LOWER(COALESCE(t.description, '')), LOWER(?::text)) > 0", q);
    const where = conditions.join(' AND ');
    const [transactions, summaryResult] = await Promise.all([
      sql.query(`
        SELECT
          t.id, t.user_id, t.category_id, t.member_id, t.type, t.amount,
          t.description, t.attachment_key, t.attachment_name, t.attachment_type,
          t.transaction_date, t.created_at, t.updated_at,
          c.name as category_name, c.icon as category_icon, c.color as category_color, c.type as category_type,
          m.name as member_name, m.avatar as member_avatar
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN members m ON t.member_id = m.id
        WHERE ${where}
        ORDER BY t.transaction_date DESC, t.created_at DESC
      `, params),
      sql.query(`
        SELECT
          SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as total_income,
          SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as total_expense,
          EXISTS (SELECT 1 FROM transactions own WHERE own.user_id = $1) as has_any_transactions
        FROM transactions t
        WHERE ${where}
      `, params),
    ]);

    // 转换数据格式，将关联的 category 和 member 组织为嵌套对象
    const formattedTransactions = transactions.map((t: Record<string, unknown>) => ({
      id: t.id,
      user_id: t.user_id,
      category_id: t.category_id,
      member_id: t.member_id,
      type: t.type,
      amount: parseFloat(String(t.amount)),
      description: t.description,
      attachment_key: t.attachment_key,
      attachment_name: t.attachment_name,
      attachment_type: t.attachment_type,
      transaction_date: t.transaction_date,
      created_at: t.created_at,
      updated_at: t.updated_at,
      category: t.category_id ? {
        id: t.category_id as string,
        user_id: t.user_id as string,
        name: t.category_name as string,
        type: t.category_type as "income" | "expense",
        icon: t.category_icon as string | null,
        color: t.category_color as string | null,
        created_at: null,
      } : undefined,
      member: t.member_id ? {
        id: t.member_id as string,
        user_id: t.user_id as string,
        name: t.member_name as string,
        avatar: t.member_avatar as string | null,
        created_at: null,
      } : undefined,
    }));

    const totalIncome = parseFloat(summaryResult[0]?.total_income || '0');
    const totalExpense = parseFloat(summaryResult[0]?.total_expense || '0');
    const balance = totalIncome - totalExpense;

    // 返回数据和统计
    return NextResponse.json({
      data: formattedTransactions,
      hasAnyTransactions: summaryResult[0]?.has_any_transactions === true,
      summary: {
        totalIncome,
        totalExpense,
        balance,
      },
    });
  } catch (error) {
    console.error('获取交易记录错误:', error);
    return NextResponse.json(
      { error: '获取交易记录失败' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/transactions
 * 创建交易记录
 * 请求体：
 * - type: 交易类型 'income' 或 'expense'
 * - category_id: 分类ID
 * - member_id: 成员ID（必填，须属于当前用户）
 * - amount: 金额
 * - transaction_date: 交易日期 YYYY-MM-DD
 * - description: 描述（可选）
 * - attachment_key: 附件key（可选）
 * - attachment_name: 附件名称（可选）
 * - attachment_type: 附件类型（可选）
 */
export async function POST(request: NextRequest) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      type,
      category_id,
      member_id,
      amount,
      transaction_date,
      description,
      attachment_key,
      attachment_name,
      attachment_type,
    } = body;

    // 验证必填字段
    if (!type || !amount || !transaction_date) {
      return NextResponse.json(
        { error: '请填写必填字段' },
        { status: 400 }
      );
    }

    if (typeof member_id !== 'string' || !member_id.trim()) {
      return NextResponse.json({ error: '请选择家庭成员' }, { status: 400 });
    }

    // 验证 type 值
    if (type !== 'income' && type !== 'expense') {
      return NextResponse.json(
        { error: '交易类型必须是 income 或 expense' },
        { status: 400 }
      );
    }

    // 验证金额格式
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json(
        { error: '金额必须大于0' },
        { status: 400 }
      );
    }

    // 分类必填，验证分类归属及收支类型
    if (typeof category_id !== 'string' || !category_id.trim()) {
      return NextResponse.json({ error: '请选择分类' }, { status: 400 });
    }
    const categories = await sql`
      SELECT id, type FROM categories
      WHERE id = ${category_id} AND user_id = ${session.userId}
    `;

    if (categories.length === 0) {
      return NextResponse.json(
        { error: '分类不存在' },
        { status: 400 }
      );
    }

    // 验证分类类型是否匹配
    if (categories[0].type !== type) {
      return NextResponse.json(
        { error: `分类类型不匹配：该分类是${categories[0].type === 'income' ? '收入' : '支出'}分类` },
        { status: 400 }
      );
    }

    // 必须选择当前用户的家庭成员
    const members = await sql`
      SELECT id FROM members
      WHERE id = ${member_id} AND user_id = ${session.userId}
    `;

    if (members.length === 0) {
      return NextResponse.json(
        { error: '家庭成员不存在' },
        { status: 400 }
      );
    }

    const attachmentError = await validateAttachment(attachment_key, session.userId);
    if (attachmentError) return attachmentError;

    // 生成 UUID
    const id = uuidv4();

    // 插入交易记录
    const [, result] = await sql.transaction([
      sql`SELECT id FROM categories WHERE id = ${category_id} AND user_id = ${session.userId} FOR SHARE`,
      sql`
      INSERT INTO transactions (
        id, user_id, category_id, member_id, type, amount, 
        description, attachment_key, attachment_name, attachment_type,
        transaction_date, created_at, updated_at
      )
      SELECT
        ${id},
        ${session.userId},
        ${category_id},
        ${member_id},
        ${type},
        ${amountNum},
        ${description || null},
        ${attachment_key || null},
        ${attachment_name || null},
        ${attachment_type || null},
        ${transaction_date},
        NOW(),
        NOW()
      WHERE EXISTS (
        SELECT 1 FROM categories WHERE id = ${category_id}
          AND user_id = ${session.userId} AND type = ${type}
      )
      RETURNING *
    `], { isolationLevel: "Serializable" });
    if (result.length === 0) {
      return NextResponse.json({ error: "分类已变更，请刷新后重试" }, { status: 409 });
    }

    return NextResponse.json({
      message: '交易记录创建成功',
      data: {
        ...result[0],
        amount: parseFloat(result[0].amount as string),
      },
    }, { status: 201 });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '40001') {
      return NextResponse.json({ error: '分类或交易已变更，请刷新后重试' }, { status: 409 });
    }
    console.error('创建交易记录错误:', error);
    return NextResponse.json(
      { error: '创建交易记录失败' },
      { status: 500 }
    );
  }
}
