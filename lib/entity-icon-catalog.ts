export type EntityIconOption = {
  value: string;
  label: string;
  group: string;
  keywords: string;
  text?: string;
};

export const DEFAULT_CATEGORY_ICON = "lucide:folder";
export const DEFAULT_MEMBER_AVATAR = "lucide:user-round";

// Stable identifiers are shared by the picker, API validation and cleanup script.
// Keep this module independent of React so server tools do not load the icon bundle.
export const CATEGORY_ICON_OPTIONS: readonly EntityIconOption[] = [
  { value: "lucide:utensils", label: "餐饮", group: "日常", keywords: "吃饭 餐厅 外卖" },
  { value: "lucide:coffee", label: "咖啡", group: "日常", keywords: "饮料 奶茶" },
  { value: "lucide:cooking-pot", label: "买菜", group: "日常", keywords: "厨房 做饭 食材" },
  { value: "lucide:apple", label: "水果", group: "日常", keywords: "蔬菜 生鲜" },
  { value: "lucide:cake-slice", label: "甜品", group: "日常", keywords: "蛋糕 零食" },
  { value: "lucide:shopping-cart", label: "购物", group: "日常", keywords: "超市 日用 采购" },
  { value: "lucide:shopping-bag", label: "百货", group: "日常", keywords: "商场 购物袋" },
  { value: "lucide:shirt", label: "服饰", group: "日常", keywords: "衣服 鞋 包" },
  { value: "lucide:scissors", label: "理发", group: "日常", keywords: "美容 剪发" },
  { value: "lucide:smartphone", label: "数码", group: "日常", keywords: "手机 话费 通讯" },
  { value: "lucide:car", label: "汽车", group: "出行居家", keywords: "交通 打车 出租" },
  { value: "lucide:bus", label: "公交", group: "出行居家", keywords: "交通 通勤" },
  { value: "lucide:train-front", label: "铁路", group: "出行居家", keywords: "地铁 火车 高铁" },
  { value: "lucide:bike", label: "骑行", group: "出行居家", keywords: "自行车 交通" },
  { value: "lucide:plane", label: "旅行", group: "出行居家", keywords: "飞机 机票 旅游" },
  { value: "lucide:fuel", label: "加油", group: "出行居家", keywords: "油费 汽车" },
  { value: "lucide:house", label: "住房", group: "出行居家", keywords: "房租 房贷 家庭" },
  { value: "lucide:bed-double", label: "住宿", group: "出行居家", keywords: "酒店 宾馆" },
  { value: "lucide:sofa", label: "家具", group: "出行居家", keywords: "家居 装修" },
  { value: "lucide:zap", label: "电费", group: "出行居家", keywords: "水电 能源" },
  { value: "lucide:droplets", label: "水费", group: "出行居家", keywords: "水电 生活缴费" },
  { value: "lucide:wifi", label: "网络", group: "出行居家", keywords: "宽带 通讯" },
  { value: "lucide:wrench", label: "维修", group: "出行居家", keywords: "工具 家政 保养" },
  { value: "lucide:gamepad-2", label: "娱乐", group: "休闲健康", keywords: "游戏" },
  { value: "lucide:clapperboard", label: "电影", group: "休闲健康", keywords: "影视 影院" },
  { value: "lucide:music", label: "音乐", group: "休闲健康", keywords: "演出 演唱会" },
  { value: "lucide:camera", label: "摄影", group: "休闲健康", keywords: "照片 相机" },
  { value: "lucide:dumbbell", label: "运动", group: "休闲健康", keywords: "健身 体育" },
  { value: "lucide:book-open", label: "教育", group: "休闲健康", keywords: "学习 书籍 培训" },
  { value: "lucide:graduation-cap", label: "学费", group: "休闲健康", keywords: "学校 教育" },
  { value: "lucide:pill", label: "药品", group: "休闲健康", keywords: "医疗 健康 买药" },
  { value: "lucide:stethoscope", label: "医疗", group: "休闲健康", keywords: "医院 看病 体检" },
  { value: "lucide:heart-pulse", label: "保健", group: "休闲健康", keywords: "健康 护理" },
  { value: "lucide:baby", label: "育儿", group: "休闲健康", keywords: "孩子 母婴 宝宝" },
  { value: "lucide:paw-print", label: "宠物", group: "休闲健康", keywords: "猫 狗" },
  { value: "lucide:flower-2", label: "鲜花", group: "休闲健康", keywords: "园艺 植物" },
  { value: "lucide:wallet", label: "工资", group: "收入财务", keywords: "薪水 收入 钱包" },
  { value: "lucide:briefcase", label: "工作", group: "收入财务", keywords: "兼职 办公" },
  { value: "lucide:trending-up", label: "投资", group: "收入财务", keywords: "理财 股票 收益" },
  { value: "lucide:landmark", label: "银行", group: "收入财务", keywords: "利息 存款" },
  { value: "lucide:banknote", label: "现金", group: "收入财务", keywords: "收入 钱" },
  { value: "lucide:coins", label: "零钱", group: "收入财务", keywords: "储蓄 积攒" },
  { value: "lucide:gift", label: "礼物", group: "收入财务", keywords: "奖金 送礼 礼金" },
  { value: "lucide:mail", label: "红包", group: "收入财务", keywords: "人情 礼金" },
  { value: "lucide:hand-coins", label: "报销", group: "收入财务", keywords: "补贴 退款 借款" },
  { value: "lucide:credit-card", label: "还款", group: "收入财务", keywords: "信用卡 贷款" },
  { value: "lucide:receipt", label: "账单", group: "收入财务", keywords: "费用 税费" },
  { value: "lucide:shield-check", label: "保险", group: "收入财务", keywords: "保障" },
  { value: "lucide:package", label: "物品", group: "其他", keywords: "快递 包裹 杂物" },
  { value: "lucide:folder", label: "其他", group: "其他", keywords: "默认 分类" },
];

export const MEMBER_AVATAR_OPTIONS: readonly EntityIconOption[] = [
  { value: "family:father", label: "爸爸", group: "家人", keywords: "父亲 老爸 爸爹 丈夫 老公" },
  { value: "family:mother", label: "妈妈", group: "家人", keywords: "母亲 老妈 妈娘 妻子 老婆" },
  { value: "family:grandfather", label: "爷爷", group: "家人", keywords: "祖父 长辈 老人" },
  { value: "family:grandmother", label: "奶奶", group: "家人", keywords: "祖母 长辈 老人" },
  { value: "family:maternal-grandfather", label: "外公", group: "家人", keywords: "姥爷 外祖父 长辈 老人" },
  { value: "family:maternal-grandmother", label: "外婆", group: "家人", keywords: "姥姥 外祖母 长辈 老人" },
  { value: "family:son", label: "儿子", group: "家人", keywords: "男孩 孩子 儿童" },
  { value: "family:daughter", label: "女儿", group: "家人", keywords: "女孩 孩子 儿童" },
  { value: "family:older-brother", label: "哥哥", group: "家人", keywords: "兄长 兄弟" },
  { value: "family:older-sister", label: "姐姐", group: "家人", keywords: "姊妹 姐妹" },
  { value: "family:younger-brother", label: "弟弟", group: "家人", keywords: "兄弟 小男孩" },
  { value: "family:younger-sister", label: "妹妹", group: "家人", keywords: "姐妹 小女孩" },
  { value: "text:father", label: "爸爸", text: "爸", group: "文字", keywords: "父亲 老爸 丈夫 老公" },
  { value: "text:mother", label: "妈妈", text: "妈", group: "文字", keywords: "母亲 老妈 妻子 老婆" },
  { value: "text:grandfather", label: "爷爷", text: "爷", group: "文字", keywords: "祖父 长辈" },
  { value: "text:grandmother", label: "奶奶", text: "奶", group: "文字", keywords: "祖母 长辈" },
  { value: "text:maternal-grandfather", label: "外公", text: "公", group: "文字", keywords: "姥爷 外祖父" },
  { value: "text:maternal-grandmother", label: "外婆", text: "婆", group: "文字", keywords: "姥姥 外祖母" },
  { value: "text:son", label: "儿子", text: "儿", group: "文字", keywords: "男孩 孩子" },
  { value: "text:daughter", label: "女儿", text: "女", group: "文字", keywords: "女孩 孩子" },
  { value: "text:older-brother", label: "哥哥", text: "哥", group: "文字", keywords: "兄长 兄弟" },
  { value: "text:older-sister", label: "姐姐", text: "姐", group: "文字", keywords: "姊妹 姐妹" },
  { value: "text:younger-brother", label: "弟弟", text: "弟", group: "文字", keywords: "兄弟" },
  { value: "text:younger-sister", label: "妹妹", text: "妹", group: "文字", keywords: "姐妹" },
  { value: "text:husband", label: "丈夫", text: "夫", group: "文字", keywords: "老公 伴侣" },
  { value: "text:wife", label: "妻子", text: "妻", group: "文字", keywords: "老婆 伴侣" },
  { value: "text:self", label: "自己", text: "我", group: "文字", keywords: "本人 自我" },
  { value: "text:baby", label: "宝贝", text: "宝", group: "文字", keywords: "宝宝 婴儿 小孩" },
  { value: "initials", label: "姓名", group: "通用", keywords: "首字 名字" },
  { value: "lucide:user-round", label: "人物", group: "通用", keywords: "自己" },
  { value: "lucide:smile", label: "笑脸", group: "通用", keywords: "开心" },
  { value: "lucide:baby", label: "宝宝", group: "通用", keywords: "孩子 婴儿 母婴" },
  { value: "lucide:heart", label: "爱心", group: "兴趣", keywords: "家人" },
  { value: "lucide:star", label: "星星", group: "兴趣", keywords: "星光" },
  { value: "lucide:sun", label: "太阳", group: "兴趣", keywords: "阳光" },
  { value: "lucide:moon", label: "月亮", group: "兴趣", keywords: "月光" },
  { value: "lucide:cat", label: "小猫", group: "动物", keywords: "宠物" },
  { value: "lucide:dog", label: "小狗", group: "动物", keywords: "宠物" },
  { value: "lucide:rabbit", label: "兔子", group: "动物", keywords: "动物" },
  { value: "lucide:bird", label: "小鸟", group: "动物", keywords: "动物" },
  { value: "lucide:flower-2", label: "花朵", group: "兴趣", keywords: "鲜花" },
  { value: "lucide:leaf", label: "叶子", group: "兴趣", keywords: "植物" },
  { value: "lucide:sprout", label: "新芽", group: "兴趣", keywords: "成长" },
  { value: "lucide:gem", label: "宝石", group: "兴趣", keywords: "珍贵" },
  { value: "lucide:coffee", label: "咖啡", group: "兴趣", keywords: "生活" },
];

export const CATEGORY_ICON_IDS = CATEGORY_ICON_OPTIONS.map(option => option.value);
export const MEMBER_AVATAR_IDS = MEMBER_AVATAR_OPTIONS.map(option => option.value);
export const MEMBER_AVATAR_TEXT: Readonly<Record<string, string>> = Object.fromEntries(
  MEMBER_AVATAR_OPTIONS.filter(option => option.text).map(option => [option.value, option.text!]),
);
const categoryIds = new Set(CATEGORY_ICON_IDS);
const memberIds = new Set(MEMBER_AVATAR_IDS);

export function isCategoryIcon(value: unknown): value is string {
  return typeof value === "string" && categoryIds.has(value);
}

export function isMemberAvatar(value: unknown): value is string {
  return typeof value === "string" && memberIds.has(value);
}
