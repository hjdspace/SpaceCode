/**
 * 5 视觉方向与色板规范 (Editorial, Modern Minimal, Human, Tech, Brutalist)
 * 对应提示词栈第 5 层 (无激活设计系统时激活)
 */

export interface VisualDirection {
  id: string;
  name: string;
  description: string;
  palette: {
    background: string;
    surface: string;
    primary: string;
    secondary: string;
    border: string;
  };
  typography: {
    fontFamilyDisplay: string;
    fontFamilyBody: string;
    fontSizeBase: string;
    lineHeightBase: string;
  };
}

export const DESIGN_DIRECTIONS: Record<string, VisualDirection> = {
  editorial: {
    id: 'editorial',
    name: 'Editorial Magazine (编辑部杂志)',
    description: '高贵、文艺、优雅。采用传统杂志排版、强烈的字重对比和大面积留白，适合内容驱动型落地页或数字专栏。',
    palette: {
      background: 'oklch(98.5% 0.005 60)',      // 极浅暖白/象牙色
      surface: 'oklch(100% 0 0)',
      primary: 'oklch(12% 0.015 30)',          // 优雅深赭/炭黑
      secondary: 'oklch(45% 0.04 45)',         // 陶土红
      border: 'oklch(88% 0.01 60)'
    },
    typography: {
      fontFamilyDisplay: '"Playfair Display", "Georgia", serif',
      fontFamilyBody: '"Lora", "Times New Roman", serif',
      fontSizeBase: '17px',
      lineHeightBase: '1.65'
    }
  },
  'modern-minimal': {
    id: 'modern-minimal',
    name: 'Modern Minimal (现代极简)',
    description: '极致克制、冷静、专业。参考 Apple 与 Vercel 的设计语言，严格依附于网格系统，极少色彩，全靠结构和几何感。',
    palette: {
      background: 'oklch(99% 0 0)',
      surface: 'oklch(100% 0 0)',
      primary: 'oklch(10% 0 0)',               // 纯黑
      secondary: 'oklch(60% 0 0)',             // 中灰
      border: 'oklch(92% 0 0)'
    },
    typography: {
      fontFamilyDisplay: '"SF Pro Display", "-apple-system", sans-serif',
      fontFamilyBody: '"SF Pro Text", "Helvetica Neue", sans-serif',
      fontSizeBase: '15px',
      lineHeightBase: '1.5'
    }
  },
  human: {
    id: 'human',
    name: 'Human Warmth (人文温润)',
    description: '友好、亲近、自然。偏向手作风和自然色调，搭配圆润无衬线字体，常见于心理、阅读、本地社区及环保产品。',
    palette: {
      background: 'oklch(97.5% 0.012 85)',     // 温和沙色/暖米色
      surface: 'oklch(99% 0.005 85)',
      primary: 'oklch(22% 0.025 120)',         // 墨绿
      secondary: 'oklch(55% 0.045 65)',        // 暖铜
      border: 'oklch(89% 0.015 85)'
    },
    typography: {
      fontFamilyDisplay: '"Fraunces", "Plus Jakarta Sans", sans-serif',
      fontFamilyBody: '"Plus Jakarta Sans", "Inter", sans-serif',
      fontSizeBase: '16px',
      lineHeightBase: '1.6'
    }
  },
  tech: {
    id: 'tech',
    name: 'Developer & Tech (前沿科技)',
    description: '极客、未来感、暗色系。大面积深色背景配上高亮霓虹强调色、等宽网格与微弱的玻璃拟态 (Glassmorphism)。',
    palette: {
      background: 'oklch(14% 0.008 240)',      // 钛黑/冷深灰
      surface: 'oklch(18% 0.012 240)',
      primary: 'oklch(70% 0.18 140)',          // 荧光绿/青
      secondary: 'oklch(60% 0.15 290)',        // 霓虹紫
      border: 'oklch(28% 0.015 240)'
    },
    typography: {
      fontFamilyDisplay: '"JetBrains Mono", "Fira Code", monospace',
      fontFamilyBody: '"Geist", "Inter", sans-serif',
      fontSizeBase: '14px',
      lineHeightBase: '1.5'
    }
  },
  brutalist: {
    id: 'brutalist',
    name: 'Neo-Brutalist (新粗野主义)',
    description: '张扬、高对比度、街头感。极具侵略性的粗黑边框、硬投影、不重叠的高饱和纯色卡片，打破一切常规对齐。',
    palette: {
      background: 'oklch(96% 0.05 100)',       // 鲜亮柠檬浅黄
      surface: 'oklch(100% 0 0)',
      primary: 'oklch(0% 0 0)',                // 纯黑描边和投影
      secondary: 'oklch(62% 0.22 340)',        // 街头亮粉
      border: 'oklch(0% 0 0)'
    },
    typography: {
      fontFamilyDisplay: '"Space Grotesk", "Impact", sans-serif',
      fontFamilyBody: '"Space Grotesk", "Courier New", sans-serif',
      fontSizeBase: '16px',
      lineHeightBase: '1.4'
    }
  }
};
