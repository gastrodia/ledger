import { validateAttachment, deleteOwnedAttachment } from "@/lib/attachments";
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getSession } from '@/lib/auth';

/**
 * PATCH /api/transactions/[id]
 * 更新交易记录
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }

    const { id } = await context.params;
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

    // 检查交易记录是否存在且属于当前用户
    const existingTransactions = await sql`
      SELECT * FROM transactions 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    if (existingTransactions.length === 0) {
      return NextResponse.json(
        { error: '交易记录不存在' },
        { status: 404 }
      );
    }

    const existingTransaction = existingTransactions[0];
    const oldAttachmentKey = (existingTransaction.attachment_key as string | null | undefined) ?? null;

    // 如果更新了 type，验证其值
    const newType = type || existingTransaction.type;
    if (type && type !== 'income' && type !== 'expense') {
      return NextResponse.json(
        { error: '交易类型必须是 income 或 expense' },
        { status: 400 }
      );
    }

    // 如果更新了金额，验证金额格式
    let newAmount = existingTransaction.amount;
    if (amount !== undefined) {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return NextResponse.json(
          { error: '金额必须大于0' },
          { status: 400 }
        );
      }
      newAmount = amountNum;
    }

    // PATCH 未提供分类时沿用原分类，但最终分类必须有效
    const newCategoryId = category_id !== undefined ? category_id : existingTransaction.category_id;
    if (typeof newCategoryId !== 'string' || !newCategoryId.trim()) {
      return NextResponse.json({ error: '请选择分类' }, { status: 400 });
    }
    const categories = await sql`
      SELECT id, type FROM categories
      WHERE id = ${newCategoryId} AND user_id = ${session.userId}
    `;

    if (categories.length === 0) {
      return NextResponse.json(
        { error: '分类不存在' },
        { status: 400 }
      );
    }

    // 验证分类类型是否匹配
    if (categories[0].type !== newType) {
      return NextResponse.json(
        { error: `分类类型不匹配：该分类是${categories[0].type === 'income' ? '收入' : '支出'}分类` },
        { status: 400 }
      );
    }

    // 如果提供了新的 member_id，验证该成员是否存在且属于当前用户
    const newMemberId = member_id !== undefined ? member_id : existingTransaction.member_id;
    if (newMemberId) {
      const members = await sql`
        SELECT id FROM members 
        WHERE id = ${newMemberId} AND user_id = ${session.userId}
      `;

      if (members.length === 0) {
        return NextResponse.json(
          { error: '家庭成员不存在' },
          { status: 400 }
        );
      }
    }

    const attachmentError = await validateAttachment(attachment_key, session.userId, oldAttachmentKey);
    if (attachmentError) return attachmentError;

    // 更新交易记录
    const [, result] = await sql.transaction([
      sql`SELECT id FROM categories WHERE id = ${newCategoryId} AND user_id = ${session.userId} FOR SHARE`,
      sql`
      UPDATE transactions
      SET
        type = ${type !== undefined ? type : existingTransaction.type},
        category_id = ${newCategoryId},
        member_id = ${newMemberId || null},
        amount = ${newAmount},
        transaction_date = ${transaction_date !== undefined ? transaction_date : existingTransaction.transaction_date},
        description = ${description !== undefined ? description : existingTransaction.description},
        attachment_key = ${attachment_key !== undefined ? attachment_key : existingTransaction.attachment_key},
        attachment_name = ${attachment_name !== undefined ? attachment_name : existingTransaction.attachment_name},
        attachment_type = ${attachment_type !== undefined ? attachment_type : existingTransaction.attachment_type},
        updated_at = NOW()
      WHERE id = ${id} AND user_id = ${session.userId}
        AND EXISTS (
          SELECT 1 FROM categories WHERE id = ${newCategoryId}
            AND user_id = ${session.userId} AND type = ${newType}
        )
      RETURNING *
    `], { isolationLevel: "Serializable" });
    if (result.length === 0) {
      return NextResponse.json({ error: "分类或交易已变更，请刷新后重试" }, { status: 409 });
    }

    // 如果附件发生变化（替换/移除），尽力删除旧 blob，避免产生孤儿文件
    if (attachment_key !== undefined && oldAttachmentKey && attachment_key !== oldAttachmentKey) {
      try {
        await deleteOwnedAttachment(oldAttachmentKey, session.userId);
      } catch (error) {
        console.error('更新交易时删除旧附件失败:', error);
      }
    }

    return NextResponse.json({
      message: '交易记录更新成功',
      data: {
        ...result[0],
        amount: parseFloat(result[0].amount as string),
      },
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === '40001') {
      return NextResponse.json({ error: '分类或交易已变更，请刷新后重试' }, { status: 409 });
    }
    console.error('更新交易记录错误:', error);
    return NextResponse.json(
      { error: '更新交易记录失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/transactions/[id]
 * 删除交易记录
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // 验证用户登录
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: '未登录' },
        { status: 401 }
      );
    }

    const { id } = await context.params;

    // 检查交易记录是否存在且属于当前用户
    const existingTransactions = await sql`
      SELECT id, attachment_key FROM transactions 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    if (existingTransactions.length === 0) {
      return NextResponse.json(
        { error: '交易记录不存在' },
        { status: 404 }
      );
    }

    // 先删除附件，保证“删除交易=同时删除附件”语义（避免留下孤儿文件）
    const attachmentKey = existingTransactions[0]?.attachment_key as string | null | undefined;
    if (attachmentKey) {
      try {
        await deleteOwnedAttachment(attachmentKey, session.userId);
      } catch (error) {
        console.error('删除交易附件失败:', error);
        return NextResponse.json(
          { error: '删除附件失败，请稍后重试' },
          { status: 500 }
        );
      }
    }

    // 删除交易记录
    await sql`
      DELETE FROM transactions 
      WHERE id = ${id} AND user_id = ${session.userId}
    `;

    return NextResponse.json({
      message: '交易记录删除成功',
    });
  } catch (error) {
    console.error('删除交易记录错误:', error);
    return NextResponse.json(
      { error: '删除交易记录失败' },
      { status: 500 }
    );
  }
}
