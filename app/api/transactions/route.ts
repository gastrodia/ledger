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
 * - startDate: 开始日期，格式：YYYY-MM-DD
 * - endDate: 结束日期，格式：YYYY-MM-DD
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
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // 构建查询条件
    let transactions;
    
    if (!type && !categoryId && !startDate && !endDate) {
      // 无筛选条件
      transactions = await sql`
        SELECT 
          t.id, t.user_id, t.category_id, t.member_id, t.type, t.amount, 
          t.description, t.attachment_key, t.attachment_name, t.attachment_type,
          t.transaction_date, t.created_at, t.updated_at,
          c.name as category_name, c.icon as category_icon, c.color as category_color, c.type as category_type,
          m.name as member_name, m.avatar as member_avatar
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN members m ON t.member_id = m.id
        WHERE t.user_id = ${session.userId}
        ORDER BY t.transaction_date DESC, t.created_at DESC
      `;
    } else {
      // 有筛选条件，构建动态查询
      let query = `
        SELECT 
          t.id, t.user_id, t.category_id, t.member_id, t.type, t.amount, 
          t.description, t.attachment_key, t.attachment_name, t.attachment_type,
          t.transaction_date, t.created_at, t.updated_at,
          c.name as category_name, c.icon as category_icon, c.color as category_color, c.type as category_type,
          m.name as member_name, m.avatar as member_avatar
        FROM transactions t
        LEFT JOIN categories c ON t.category_id = c.id
        LEFT JOIN members m ON t.member_id = m.id
        WHERE t.user_id = $1
      `;
      
      const params: unknown[] = [session.userId];
      let paramIndex = 2;

      if (type && (type === 'income' || type === 'expense')) {
        query += ` AND t.type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }

      if (categoryId) {
        query += ` AND t.category_id = $${paramIndex}`;
        params.push(categoryId);
        paramIndex++;
      }

      if (startDate) {
        query += ` AND t.transaction_date >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        query += ` AND t.transaction_date <= $${paramIndex}`;
        params.push(`${endDate} 23:59:59`);
        paramIndex++;
      }

      query += ' ORDER BY t.transaction_date DESC, t.created_at DESC';
      
      transactions = await sql.query(query, params);
    }

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

    // 计算统计摘要
    let summaryResult;
    
    if (!type && !categoryId && !startDate && !endDate) {
      summaryResult = await sql`
        SELECT 
          SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
          SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense
        FROM transactions
        WHERE user_id = ${session.userId}
      `;
    } else {
      let summaryQuery = `
        SELECT 
          SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
          SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense
        FROM transactions
        WHERE user_id = $1
      `;
      
      const params: unknown[] = [session.userId];
      let paramIndex = 2;

      if (type && (type === 'income' || type === 'expense')) {
        summaryQuery += ` AND type = $${paramIndex}`;
        params.push(type);
        paramIndex++;
      }

      if (categoryId) {
        summaryQuery += ` AND category_id = $${paramIndex}`;
        params.push(categoryId);
        paramIndex++;
      }

      if (startDate) {
        summaryQuery += ` AND transaction_date >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }

      if (endDate) {
        summaryQuery += ` AND transaction_date <= $${paramIndex}`;
        params.push(`${endDate} 23:59:59`);
        paramIndex++;
      }

      summaryResult = await sql.query(summaryQuery, params);
    }

    const totalIncome = parseFloat(summaryResult[0]?.total_income || '0');
    const totalExpense = parseFloat(summaryResult[0]?.total_expense || '0');
    const balance = totalIncome - totalExpense;

    // 返回数据和统计
    return NextResponse.json({
      data: formattedTransactions,
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
 * - member_id: 成员ID（可选）
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

    // 如果提供了 category_id，验证该分类是否存在且属于当前用户
    if (category_id) {
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
    }

    // 如果提供了 member_id，验证该成员是否存在且属于当前用户
    if (member_id) {
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
    }

    // 生成 UUID
    const id = uuidv4();

    // 插入交易记录
    const result = await sql`
      INSERT INTO transactions (
        id, user_id, category_id, member_id, type, amount, 
        description, attachment_key, attachment_name, attachment_type,
        transaction_date, created_at, updated_at
      )
      VALUES (
        ${id},
        ${session.userId},
        ${category_id || null},
        ${member_id || null},
        ${type},
        ${amountNum},
        ${description || null},
        ${attachment_key || null},
        ${attachment_name || null},
        ${attachment_type || null},
        ${transaction_date},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return NextResponse.json({
      message: '交易记录创建成功',
      data: {
        ...result[0],
        amount: parseFloat(result[0].amount as string),
      },
    }, { status: 201 });
  } catch (error) {
    console.error('创建交易记录错误:', error);
    return NextResponse.json(
      { error: '创建交易记录失败' },
      { status: 500 }
    );
  }
}
