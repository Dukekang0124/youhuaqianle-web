// 分类词典与商户品牌词表 —— 逐字对齐 app/lib/core/lexicon.dart
// 一致性由 tools/web-parity.mjs 校验：这个文件与 Dart 真源有任何一词之差，闸门即红。
export const CATEGORIES = [
  {
    name: '餐饮',
    emoji: '🍜',
    words: [
      '吃', '喝', '饭', '外卖', '奶茶', '咖啡', '拿铁', '美式', '烧烤', '包子',
      '油条', '煎饼', '面条', '面馆', '早餐', '午餐', '晚餐', '夜宵', '食堂', '餐',
      '火锅', '串串', '炸鸡', '汉堡', '披萨', '麻辣烫', '沙县', '轻食', '喝酒', '请吃饭',
      '山药',
    ],
  },
  {
    name: '交通',
    emoji: '🚇',
    words: [
      '地铁', '公交', '打车', '滴滴', '出租', '高德打车', '顺风车', '高铁', '火车',
      '机票', '航班', '加油', '停车', '共享单车', '单车', '自行车', '电瓶车充电', '船票',
      '车票', '路费',
      // 口语化（v0.14.7）：与 Dart 同序——「养车花了三千五」原先落「其他」。
      '养车',
    ],
  },
  {
    name: '购物',
    emoji: '🛍',
    words: [
      '买', '淘宝', '京东', '拼多多', '天猫', '衣服', '鞋', '包包', '日用', '超市',
      '便利店', '杂货', '采购', '囤货', '下单', '鞋子',
    ],
  },
  {
    name: '娱乐',
    emoji: '🎮',
    words: [
      '电影', '电影票', '观影', '游戏', '充值', '会员', 'KTV', '门票', '唱', '演唱会',
      '剧本杀', '密室', '按摩', '洗澡', '游泳', '健身', '台球', '网费',
    ],
  },
  {
    name: '居住',
    emoji: '🏠',
    words: [
      '房租', '水电', '物业', '燃气', '宽带', '电费', '水费', '话费', '话费充值', '装修',
      '流量', '住宿', '酒店', '民宿', '家政', '保洁',
    ],
  },
  {
    name: '医疗',
    emoji: '💊',
    words: ['药', '医院', '挂号', '体检', '诊所', '牙', '疫苗', '门诊', '看病', '买药'],
  },
  {
    name: '教育',
    emoji: '📚',
    words: ['书', '课', '培训', '考试', '网课', '学费', '报名费'],
  },
  {
    name: '人情',
    emoji: '🎁',
    words: ['红包', '随礼', '请客', '礼物', '送礼', '份子钱', '孝敬'],
  },
  {
    name: '数码',
    emoji: '💻',
    words: [
      '手机',
      '耳机',
      '电脑',
      '充电线',
      '键盘',
      '鼠标',
      '配件',
      '数码',
      // 中英混说（v0.14.7）：与 app/lib/core/lexicon.dart 同序——
      // 这批英文名与 goods_lexicon 里的英文物品词一一对应。
      'iPhone',
      'iPad',
      'MacBook',
      'AirPods',
      'Kindle',
      'PS5',
      'GoPro',
    ],
  },
  {
    name: '工资',
    emoji: '💰',
    words: ['工资', '发薪', '薪水', '年终奖', '奖金'],
  },
  { name: '其他', emoji: '❓', words: [] },
];

export const BRANDS = [
  { brand: '星巴克', category: '餐饮' },
  { brand: '瑞幸', category: '餐饮' },
  { brand: '麦当劳', category: '餐饮' },
  { brand: '肯德基', category: '餐饮' },
  { brand: '必胜客', category: '餐饮' },
  { brand: '海底捞', category: '餐饮' },
  { brand: '蜜雪冰城', category: '餐饮' },
  { brand: '喜茶', category: '餐饮' },
  { brand: '霸王茶姬', category: '餐饮' },
  { brand: '沪上阿姨', category: '餐饮' },
  { brand: '塔斯汀', category: '餐饮' },
  { brand: '沙县小吃', category: '餐饮' },
  { brand: '全家', category: '购物' },
  { brand: '罗森', category: '购物' },
  { brand: '711', category: '购物' },
  { brand: '7-11', category: '购物' },
  { brand: '便利蜂', category: '购物' },
  { brand: '山姆', category: '购物' },
  { brand: '盒马', category: '购物' },
  { brand: '永辉', category: '购物' },
  { brand: '沃尔玛', category: '购物' },
  { brand: 'Costco', category: '购物' },
  { brand: '开市客', category: '购物' },
  { brand: '优衣库', category: '购物' },
  { brand: '迪卡侬', category: '购物' },
  { brand: '名创优物', category: '购物' },
  { brand: 'KKV', category: '购物' },
  { brand: '淘宝', category: '购物' },
  { brand: '京东', category: '购物' },
  { brand: '拼多多', category: '购物' },
  { brand: '天猫', category: '购物' },
  { brand: '抖音商城', category: '购物' },
  { brand: '得物', category: '购物' },
  { brand: '美团', category: '餐饮' },
  { brand: '饿了么', category: '餐饮' },
  { brand: '滴滴', category: '交通' },
  { brand: '高德', category: '交通' },
  { brand: '花小猪', category: '交通' },
  { brand: '曹操出行', category: '交通' },
  { brand: 'T3出行', category: '交通' },
  { brand: '12306', category: '交通' },
  { brand: '铁路', category: '交通' },
  { brand: '东航', category: '交通' },
  { brand: '国航', category: '交通' },
  { brand: '南航', category: '交通' },
  { brand: '中石化', category: '交通' },
  { brand: '中石油', category: '交通' },
  { brand: '特来电', category: '交通' },
  { brand: '哈啰', category: '交通' },
  { brand: '青桔', category: '交通' },
  { brand: '中国移动', category: '居住' },
  { brand: '中国联通', category: '居住' },
  { brand: '中国电信', category: '居住' },
  { brand: '爱奇艺', category: '娱乐' },
  { brand: '优酷', category: '娱乐' },
  { brand: '腾讯会员', category: '娱乐' },
  { brand: '网易云', category: '娱乐' },
  { brand: 'QQ音乐', category: '娱乐' },
  { brand: 'Steam', category: '娱乐' },
  { brand: '任天堂', category: '数码' },
  { brand: '苹果', category: '数码' },
  { brand: 'Apple', category: '数码' },
  { brand: '华为', category: '数码' },
  { brand: '小米', category: '数码' },
  { brand: '丁香医生', category: '医疗' },
  { brand: '美团买药', category: '医疗' },
  { brand: '得到', category: '教育' },
  { brand: '喜马拉雅', category: '教育' },
  { brand: '新东方', category: '教育' },
];

export const INCOME_WORDS = ['工资', '发薪', '报销', '入账', '收到', '中了', '返现', '利息'];
export const REFUND_WORDS = ['退款', '退了', '退回', '退给'];

// 平台/渠道词（v0.14.2 FR-7）：不参与判类、不直接入账、不当商户名，
// 只当「换地方了」的信号（闸①，见 parser.js 的 merchantInheritable）。
export const PLATFORM_WORDS = [
  '拼多多', '淘宝', '天猫', '京东', '抖音', '小红书', '闲鱼', '得物', '唯品会',
  '美团', '饿了么', '山姆', '盒马', 'Costco', '7-11', '便利店', '超市', '网上',
  '电商', '小程序', '直播',
];

export function categoryByName(name) {
  return CATEGORIES.find((c) => c.name === name) ?? CATEGORIES[CATEGORIES.length - 1];
}
