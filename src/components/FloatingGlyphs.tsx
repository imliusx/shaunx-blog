'use client';

import { usePathname } from 'next/navigation';

/**
 * 全站背景装饰层：稀疏的等宽字符缓慢漂浮
 *
 * 约定：
 * - 位置和动画参数全部由固定种子的伪随机生成，保证服务端与客户端渲染一致，
 *   不能用 Math.random()，否则会触发 hydration mismatch
 * - 用 position: fixed 锚在视口上。列表页和文章页会滚动，若用 absolute，
 *   24 个字符会被摊到整个滚动高度上，长文里稀到看不见
 * - 只动 transform 和 opacity，避免触发重排
 * - 文章详情页是长文阅读场景，透明度减半，避免正文背后的纹理干扰阅读
 * - 管理后台不挂载
 * - 纯装饰，对辅助技术隐藏；尊重 prefers-reduced-motion
 */

const GLYPHS = ['$', '~', '{}', '</>', '#', '//', '>_', '[]', '&&', '::', '--', '==', ';;', '|'];

const GLYPH_COUNT = 36;

// 中心避让区（百分比）。首页据此避开居中的标题与分类网格；
// 滚动页面因为层是 fixed 的，这块留白等于让正文所在的视口中段始终清爽
// 范围比漂移前的静止位置略大，用来吸收字符漂移后可能的越界
const SAFE_ZONE = { xMin: 18, xMax: 82, yMin: 24, yMax: 82 };


interface Glyph {
  char: string;
  left: number;
  top: number;
  size: number;
  scale: number;
  dx: number;
  dy: number;
  duration: number;
  delay: number;
}

/**
 * 线性同余伪随机数，固定种子保证每次渲染结果完全一致
 */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function isInSafeZone(left: number, top: number): boolean {
  return (
    left > SAFE_ZONE.xMin &&
    left < SAFE_ZONE.xMax &&
    top > SAFE_ZONE.yMin &&
    top < SAFE_ZONE.yMax
  );
}

function generateGlyphs(): Glyph[] {
  const random = createRandom(20260822);
  const glyphs: Glyph[] = [];
  let guard = 0;

  // guard 防止避让区参数被改大后陷入死循环
  while (glyphs.length < GLYPH_COUNT && guard < GLYPH_COUNT * 40) {
    guard += 1;

    const left = random() * 96 + 2;
    const top = random() * 94 + 3;
    if (isInSafeZone(left, top)) continue;

    glyphs.push({
      char: GLYPHS[Math.floor(random() * GLYPHS.length)],
      left,
      top,
      size: random() * 1.1 + 0.9,
      scale: random() * 0.6 + 0.7,
      dx: random() * 90 - 45,
      dy: random() * 76 - 54,
      duration: random() * 24 + 18,
      // 负延迟让各字符从周期中段开始，避免同时启动导致齐步走
      delay: -(random() * 40),
    });
  }

  return glyphs;
}

const GLYPH_FIELD = generateGlyphs();

/** 文章详情页：/posts/<slug>，但不含 /posts 列表页本身 */
const ARTICLE_PATH = /^\/posts\/[^/]+\/?$/;

export function FloatingGlyphs() {
  const pathname = usePathname();

  // 管理后台是功能界面，不挂装饰层
  if (pathname.startsWith('/admin')) {
    return null;
  }

  const isArticle = ARTICLE_PATH.test(pathname);

  return (
    <div
      className={`glyph-field${isArticle ? ' glyph-field--dim' : ''}`}
      aria-hidden="true"
    >
      {GLYPH_FIELD.map((glyph, index) => (
        <span
          key={index}
          className="glyph-field__item"
          style={
            {
              left: `${glyph.left}%`,
              top: `${glyph.top}%`,
              fontSize: `${glyph.size}rem`,
              animationDuration: `${glyph.duration}s`,
              animationDelay: `${glyph.delay}s`,
              '--g-scale': glyph.scale,
              '--g-dx': `${glyph.dx}px`,
              '--g-dy': `${glyph.dy}px`,
            } as React.CSSProperties
          }
        >
          {glyph.char}
        </span>
      ))}
    </div>
  );
}
