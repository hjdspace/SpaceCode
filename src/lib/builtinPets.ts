// src/lib/builtinPets.ts
// 4 只内置宠物定义。封面图来自 src/assets/agent-mascots/。
// 每只宠物有独立的精灵图（从 cc-haha 复制），atlas 布局一致但外观不同。

import dadaCover from '@/assets/agent-mascots/agent-mascot-code.png'
import huhuCover from '@/assets/agent-mascots/agent-mascot-plan.png'
import bubuCover from '@/assets/agent-mascots/agent-mascot-fix.png'
import huihuiCover from '@/assets/agent-mascots/agent-mascot-build.png'
import dadaSheet from '@/assets/pets/dada-code/spritesheet.webp'
import huhuSheet from '@/assets/pets/huhu-plan/spritesheet.webp'
import bubuSheet from '@/assets/pets/bubu-fix/spritesheet.webp'
import huihuiSheet from '@/assets/pets/huihui-build/spritesheet.webp'
import type { BuiltinPetDescriptor } from '@/types/pet'

export const BUILTIN_PETS: readonly BuiltinPetDescriptor[] = [
  {
    source: 'builtin',
    id: 'dada-code',
    displayName: '搭搭 Dada',
    description: '沉稳的协作机器人，陪你把想法一块块搭起来。',
    imageUrl: dadaCover,
    spritesheetUrl: dadaSheet,
    spriteVersionNumber: 2,
    accent: '#4fd1b6',
  },
  {
    source: 'builtin',
    id: 'huhu-plan',
    displayName: '弧弧 Huhu',
    description: '拿着铅笔和计划本的路线机器人，复杂任务也能找到出口。',
    imageUrl: huhuCover,
    spritesheetUrl: huhuSheet,
    spriteVersionNumber: 2,
    accent: '#6ea8ff',
  },
  {
    source: 'builtin',
    id: 'bubu-fix',
    displayName: '补补 Bubu',
    description: '举着修补扳手的小机器人，最擅长发现并修好裂缝。',
    imageUrl: bubuCover,
    spritesheetUrl: bubuSheet,
    spriteVersionNumber: 2,
    accent: '#ff9a76',
  },
  {
    source: 'builtin',
    id: 'huihui-build',
    displayName: '回回 Huihui',
    description: '抱着构建齿轮的小机器人，新回复一到就精神满满。',
    imageUrl: huihuiCover,
    spritesheetUrl: huihuiSheet,
    spriteVersionNumber: 2,
    accent: '#9b8cff',
  },
]

export function findBuiltinPet(id: string): BuiltinPetDescriptor {
  return BUILTIN_PETS.find((pet) => pet.id === id) ?? BUILTIN_PETS[0]!
}
