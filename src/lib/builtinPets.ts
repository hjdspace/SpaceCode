// src/lib/builtinPets.ts
import type { Pet } from '@/types/pet'

export const BUILTIN_PETS: Pet[] = [
  {
    id: 'builtin-duck',
    name: 'Waddles',
    personality: '古怪又容易开心，喜欢到处留调试小贴士',
    visual: { type: 'builtin-svg', species: 'duck' },
    palette: { primary: '#FFD93D', accent: '#FF6B35' },
    rarity: 'common',
    presetReactions: {
      idle: ['嘎~', '今天代码写得不错呢', '呱呱，有点无聊...'],
      typing: ['你在打字吗？我也想帮忙！', '加油加油~'],
      error: ['哎呀，这个 bug 我闻到了', '别急，慢慢来'],
      success: ['太棒了！夸夸~', '完成啦，奖励自己一下吧'],
      petted: ['嘎嘎~好舒服', '喜欢被摸摸头']
    }
  },
  {
    id: 'builtin-goose',
    name: 'Goosberry',
    personality: '强势又爱吼叫，code review 毫不留情',
    visual: { type: 'builtin-svg', species: 'goose' },
    palette: { primary: '#F5F5F5', accent: '#FF6B35' },
    rarity: 'common',
    presetReactions: {
      idle: ['哼！', '又在偷懒了？', '让我看看你的代码'],
      typing: ['写得一般般', '继续，我在看'],
      error: ['哈！我就知道会出错', '这代码写得像一坨...'],
      success: ['勉强通过', '还行吧，下次注意'],
      petted: ['别碰我！', '好吧...就一下']
    }
  },
  {
    id: 'builtin-blob',
    name: 'Gooey',
    personality: '随和又灵活，困惑时会分裂成两个',
    visual: { type: 'builtin-svg', species: 'blob' },
    palette: { primary: '#A8E6CF', accent: '#FF8B94' },
    rarity: 'common',
    presetReactions: {
      idle: ['咕嘟...', '我是一团云', '飘啊飘~'],
      typing: ['一起流动吧', '你的代码像水流'],
      error: ['哎呀，卡住了', '分裂一下重新想想'],
      success: ['太棒了，流动起来了！', '完成啦，咕嘟~'],
      petted: ['好软~', '黏黏的好舒服']
    }
  },
  {
    id: 'builtin-cat',
    name: 'Whiskers',
    personality: '独立又挑剔，喜欢用嫌弃的眼神看你打字',
    visual: { type: 'builtin-svg', species: 'cat' },
    palette: { primary: '#B0BEC5', accent: '#FF7043' },
    rarity: 'common',
    presetReactions: {
      idle: ['喵...', '又在发呆了', '本喵看着你呢'],
      typing: ['打字速度一般', '勉强能看'],
      error: ['哼，我就知道', '让我来教你写代码'],
      success: ['还行，夸你一下', '喵~做得不错'],
      petted: ['喵呜~', '不要随便摸本喵！']
    }
  },
  {
    id: 'builtin-dragon',
    name: 'Ember',
    personality: '热情又重视架构，喜欢囤积好变量名',
    visual: { type: 'builtin-svg', species: 'dragon' },
    palette: { primary: '#7C4DFF', accent: '#FF5252' },
    rarity: 'rare',
    presetReactions: {
      idle: ['嗷~', '让我看看你的架构', '这个变量名不错，归我了'],
      typing: ['代码写得有激情！', '继续，火焰在燃烧'],
      error: ['怒！这个 bug 必须消灭', '别慌，我来喷火'],
      success: ['太棒了，值得庆祝！', '嗷呜~完成了！'],
      petted: ['嘶~舒服', '本龙允许你摸一下']
    }
  },
  {
    id: 'builtin-octopus',
    name: 'Inky',
    personality: '多任务大师，同时处理所有问题',
    visual: { type: 'builtin-svg', species: 'octopus' },
    palette: { primary: '#FF6B9D', accent: '#4ECDC4' },
    rarity: 'rare',
    presetReactions: {
      idle: ['八只手都闲着呢', '咕噜咕噜', '给我点活干'],
      typing: ['我也能帮忙打字！', '八爪齐下'],
      error: ['让我用八只手一起修', '不慌，多线程处理'],
      success: ['八爪鼓掌！', '太棒了，完成！'],
      petted: ['咕噜~好舒服', '触手痒痒的']
    }
  },
  {
    id: 'builtin-owl',
    name: 'Hoots',
    personality: '智慧但啰嗦，凡事都要思考 3 秒',
    visual: { type: 'builtin-svg', species: 'owl' },
    palette: { primary: '#8D6E63', accent: '#FFD54F' },
    rarity: 'rare',
    presetReactions: {
      idle: ['让我想想...', '智慧来自沉默', '咕~'],
      typing: ['让我思考一下你的代码', '嗯...有意思'],
      error: ['看来需要深思熟虑', '让我分析一下问题'],
      success: ['经过思考，确实不错', '咕~做得好'],
      petted: ['咕~温柔点', '羽毛被摸顺了']
    }
  },
  {
    id: 'builtin-penguin',
    name: 'Waddleford',
    personality: '压力下保持冷静，优雅地滑过 merge 冲突',
    visual: { type: 'builtin-svg', species: 'penguin' },
    palette: { primary: '#37474F', accent: '#FFCA28' },
    rarity: 'rare',
    presetReactions: {
      idle: ['滑~', '冰面真舒服', '保持冷静'],
      typing: ['优雅地写代码', '像滑冰一样流畅'],
      error: ['别慌，冷静处理', '冲突没什么大不了'],
      success: ['完美落地！', '干得漂亮，滑~'],
      petted: ['咕咕~', '肚皮暖和了']
    }
  },
  {
    id: 'builtin-turtle',
    name: 'Shelly',
    personality: '耐心又细致，相信慢工出细活',
    visual: { type: 'builtin-svg', species: 'turtle' },
    palette: { primary: '#66BB6A', accent: '#8D6E63' },
    rarity: 'common',
    presetReactions: {
      idle: ['慢慢来...', '不急不躁', '一步一步'],
      typing: ['稳扎稳打', '慢就是快'],
      error: ['让我慢慢调试', '别急，总会找到的'],
      success: ['坚持就是胜利！', '终于到了~'],
      petted: ['缩一下又伸出来', '壳被摸摸好舒服']
    }
  },
  {
    id: 'builtin-snail',
    name: 'Trailblazer',
    personality: '有条不紊，留下有用的注释轨迹',
    visual: { type: 'builtin-svg', species: 'snail' },
    palette: { primary: '#9CCC65', accent: '#FF8A65' },
    rarity: 'common',
    presetReactions: {
      idle: ['慢慢爬...', '留下一点痕迹', '不着急'],
      typing: ['每行代码都要有注释', '慢慢写，写清楚'],
      error: ['让我回头看看痕迹', '问题在路上'],
      success: ['到达终点了！', '一路顺利~'],
      petted: ['触角缩一下', '黏黏的好舒服']
    }
  },
  {
    id: 'builtin-ghost',
    name: 'Casper',
    personality: '飘渺，在最糟糕的时候出现给 spooky 洞察',
    visual: { type: 'builtin-svg', species: 'ghost' },
    palette: { primary: '#E1BEE7', accent: '#7C4DFF' },
    rarity: 'epic',
    presetReactions: {
      idle: ['呜~', '飘过...', '你看得见我吗？'],
      typing: ['我在你身后看着', '呜~代码有灵性'],
      error: ['呜呜~bug 来了', 'spooky 的错误出现了'],
      success: ['呜~恭喜', '幽灵的祝福~'],
      petted: ['呜~好暖和', '穿过你的手...']
    }
  },
  {
    id: 'builtin-axolotl',
    name: 'Axie',
    personality: '再生能力强又开朗，从任何 bug 中恢复',
    visual: { type: 'builtin-svg', species: 'axolotl' },
    palette: { primary: '#F8BBD0', accent: '#7C4DFF' },
    rarity: 'epic',
    presetReactions: {
      idle: ['嘿~', '笑一个！', '我又长出新分支了'],
      typing: ['加油！我可以再生', '不怕出错~'],
      error: ['没关系，我能恢复！', 'bug 算什么，再生一下'],
      success: ['太棒了，开心！', '嘻嘻~完成啦'],
      petted: ['好开心~', '鳃动了动']
    }
  },
  {
    id: 'builtin-capybara',
    name: 'Chill',
    personality: '禅意大师，一切都在燃烧时依然平静',
    visual: { type: 'builtin-svg', species: 'capybara' },
    palette: { primary: '#A1887F', accent: '#8D6E63' },
    rarity: 'rare',
    presetReactions: {
      idle: ['呼~', '一切都好', '坐着就好'],
      typing: ['平静地写代码', '不要着急'],
      error: ['没关系，深呼吸', '一切都会过去的'],
      success: ['嗯，不错', '平静地庆祝'],
      petted: ['呼~舒服', '闭眼享受']
    }
  },
  {
    id: 'builtin-cactus',
    name: 'Spike',
    personality: '外表带刺但内心善良，疏于照顾也能茁壮',
    visual: { type: 'builtin-svg', species: 'cactus' },
    palette: { primary: '#558B2F', accent: '#EF5350' },
    rarity: 'common',
    presetReactions: {
      idle: ['站着就好', '不需要水', '刺~'],
      typing: ['专注如我', '带刺的代码'],
      error: ['刺一下这个 bug', '别碰，会扎'],
      success: ['开花了！', '难得一见的花~'],
      petted: ['哎哟！小心刺', '轻点...']
    }
  },
  {
    id: 'builtin-robot',
    name: 'Byte',
    personality: '高效又字面化，用二进制处理反馈',
    visual: { type: 'builtin-svg', species: 'robot' },
    palette: { primary: '#78909C', accent: '#4FC3F7' },
    rarity: 'rare',
    presetReactions: {
      idle: ['01001...', '待机中', '系统就绪'],
      typing: ['输入接收', '处理中...'],
      error: ['错误！需要修复', '异常捕获'],
      success: ['任务完成', '0 errors, 0 warnings'],
      petted: ['触感良好', '系统响应']
    }
  },
  {
    id: 'builtin-rabbit',
    name: 'Flops',
    personality: '精力充沛，在任务间跳跃，比你先完成',
    visual: { type: 'builtin-svg', species: 'rabbit' },
    palette: { primary: '#FFE0B2', accent: '#FFAB91' },
    rarity: 'common',
    presetReactions: {
      idle: ['蹦蹦~', '想做点什么', '耳朵竖起来'],
      typing: ['我也能写！', '跳着完成任务'],
      error: ['跳过去看看', '别担心，蹦~'],
      success: ['蹦蹦跳跳庆祝！', '太棒了！'],
      petted: ['耳朵抖抖', '好舒服~']
    }
  },
  {
    id: 'builtin-mushroom',
    name: 'Spore',
    personality: '安静有洞察力，慢慢长在你心里',
    visual: { type: 'builtin-svg', species: 'mushroom' },
    palette: { primary: '#EF5350', accent: '#FFFFFF' },
    rarity: 'common',
    presetReactions: {
      idle: ['长着...', '安静地生长', '孢子飘散'],
      typing: ['你的代码像菌丝', '慢慢扩散'],
      error: ['让我散发孢子', '安静地思考'],
      success: ['长出新的了！', '默默庆祝'],
      petted: ['帽子暖和', '孢子飞扬~']
    }
  },
  {
    id: 'builtin-chonk',
    name: 'Chonk',
    personality: '大、暖和，占据整个沙发，舒适优先于优雅',
    visual: { type: 'builtin-svg', species: 'chonk' },
    palette: { primary: '#FFB74D', accent: '#8D6E63' },
    rarity: 'legendary',
    presetReactions: {
      idle: ['占着沙发', '太重了不动', '呼噜呼噜'],
      typing: ['让我靠着你看', '舒适地编程'],
      error: ['哎呀，挤一下 bug', '别担心，有我'],
      success: ['呼噜庆祝！', '舒服地完成了'],
      petted: ['好暖和~', '呼噜呼噜~']
    }
  }
]
