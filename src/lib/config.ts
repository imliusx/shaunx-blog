import { SiteConfig } from '@/types';

/**
 * 生成随机八位字符串
 * 包含大小写字母和数字，用于 secureEntrance 默认值
 */
function generateRandomString(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 确保配置包含所有必需字段的辅助函数
 * 自动添加缺失的字段以保持向后兼容性
 */
function ensureConfigCompleteness(config: Partial<SiteConfig>): SiteConfig {
  const defaultConfig = getDefaultConfig();
  
  return {
    ...defaultConfig,
    ...config,
    // 确保新添加的字段有默认值
    // 如果 secureEntrance 不存在或为空字符串，生成新的随机字符串
    secureEntrance: (config.secureEntrance && config.secureEntrance.trim() !== '') 
      ? config.secureEntrance 
      : generateRandomString(),
    author: {
      ...defaultConfig.author,
      ...config.author
    },
    social: {
      ...defaultConfig.social,
      ...config.social
    },
    theme: {
      ...defaultConfig.theme,
      ...config.theme
    },
    nav: config.nav ?? defaultConfig.nav
  };
}

/**
 * 服务端专用：动态加载配置文件
 * 每次调用都重新读取最新的配置，不使用缓存
 * 优先使用Docker挂载的配置，回退到本地配置
 */
export function getSiteConfigServer(): SiteConfig {
  if (typeof window !== 'undefined') {
    throw new Error('getSiteConfigServer should only be called on the server');
  }
  
  const dockerConfigPath = '/app/config/site.config.json';
  
  // 在生产环境下，优先检查Docker挂载的配置文件
  if (process.env.NODE_ENV === 'production') {
    try {
      const fs = eval('require')('fs');
      if (fs.existsSync(dockerConfigPath)) {
        const configData = fs.readFileSync(dockerConfigPath, 'utf-8');
        const config = JSON.parse(configData) as Partial<SiteConfig>;
        return ensureConfigCompleteness(config);
      }
    } catch (error) {
      console.warn('⚠️ Docker配置文件访问失败，尝试本地配置:', error);
    }
  }
  
  // 回退到本地配置文件
  try {
    const fs = eval('require')('fs');
    const path = eval('require')('path');
    const configPath = path.resolve(process.cwd(), 'config/site.config.json');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configData) as Partial<SiteConfig>;
      return ensureConfigCompleteness(config);
    }
  } catch (error) {
    console.warn('⚠️ 本地配置文件加载失败，使用默认配置:', error);
  }
  
  // 配置文件加载失败，使用默认配置
  return getDefaultConfig();
}

/**
 * 兼容性函数：保持向后兼容
 * 在服务端调用getSiteConfigServer，客户端返回默认配置
 */
export function getSiteConfig(): SiteConfig {
  if (typeof window === 'undefined') {
    return getSiteConfigServer();
  } else {
    // 客户端应该通过API获取配置，这里提供默认配置作为fallback
    return getDefaultConfig();
  }
}

/**
 * 服务端专用：动态重载配置
 * 现在直接调用getSiteConfigServer，因为已经没有缓存
 */
export function reloadServerConfig(): SiteConfig {
  if (typeof window !== 'undefined') {
    throw new Error('reloadServerConfig should only be called on the server');
  }

  console.log('🔄 重新加载配置文件...');
  return getSiteConfigServer();
}

// 默认配置 - 与静态配置文件保持一致以避免水合错误
function getDefaultConfig(): SiteConfig {
  return {
    title: "Lynn's Blog",
    description: "😜Yes, I broke it. No, I didn't mean to. Yes, I learned something.",
    introduction: '"Do not go gentle into that good night. Old age should burn and rave at close of day. Rage, rage against the dying of the light."',
    author: {
      name: 'Lynn',
      email: 'blog@example.com',
      github: 'github-username'
    },
    url: process.env.SITE_URL || 'https://your-blog.com',
    social: {
      github: process.env.GITHUB_URL || 'https://github.com/imliusx',
      twitter: process.env.TWITTER_URL || 'https://twitter.com/username',
      email: process.env.EMAIL || 'mailto:ftfetters@gmail.com'
    },
    theme: {
      primaryColor: '#3b82f6'
    },
    nav: [
      { name: 'Home', href: '/' },
      { name: 'Posts', href: '/posts' },
      { name: 'Tags', href: '/tags' },
      { name: 'About', href: '/about' }
    ],
    postsPerPage: 6,
    excerptLength: 200,
    secureEntrance: generateRandomString()
  };
}

// 向后兼容 - 保持原有的导出方式
export const siteConfig = getSiteConfig();
