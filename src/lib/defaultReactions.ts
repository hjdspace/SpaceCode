// src/lib/defaultReactions.ts
import type { PresetReactions } from '@/types/pet'

export const DEFAULT_PRESET_REACTIONS: PresetReactions = {
  idle: ['咕...', '在发呆吗？', '今天天气不错呢', '需要我帮忙吗？'],
  typing: ['加油~', '写得不错！', '继续继续', '看起来很专注呢'],
  error: ['哎呀出错了', '别急，慢慢调', '我闻到 bug 的味道了', '休息一下？'],
  success: ['太棒了！', '完成啦！', '夸夸~', '奖励自己一下吧'],
  petted: ['好舒服~', '喜欢被摸摸', '再摸摸我吧', '嘿嘿~']
}
