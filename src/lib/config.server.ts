import { SiteConfig } from '@/types';
import fs from 'fs';
import path from 'path';

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
 * 服务端配置加载器
 * 仅在服务端运行，支持从Docker挂载目录动态加载配置
 */
export function loadServerSiteConfig(): SiteConfig {
  // 配置文件路径优先级：
  // 1. Docker挂载的配置目录 /app/config/site.config.json
  // 2. 项目根目录的配置文件
  
  const dockerConfigPath = '/app/config/site.config.json';
  const localConfigPath = path.resolve(process.cwd(), 'config/site.config.json');
  
  let configPath = localConfigPath;
  let isDockerConfig = false;
  
  // 在生产环境中，优先使用挂载的配置
  if (process.env.NODE_ENV === 'production' && fs.existsSync(dockerConfigPath)) {
    configPath = dockerConfigPath;
    isDockerConfig = true;
    console.log('📖 加载Docker挂载的JSON配置文件:', dockerConfigPath);
  } else if (fs.existsSync(localConfigPath)) {
    console.log('📖 加载本地JSON配置文件:', localConfigPath);
  } else {
    // 在构建时，配置文件可能不存在，直接返回默认配置，不记录警告
    if (process.env.NODE_ENV !== 'production') {
      console.log('📄 使用默认配置（构建时或开发时）');
    }
    return getDefaultConfig();
  }
  
  try {
    // 读取JSON配置文件
    const configData = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configData) as Partial<SiteConfig>;
    return ensureConfigCompleteness(config);
  } catch (error) {
    // 只在真正的错误时才记录
    if (fs.existsSync(configPath)) {
      console.error('❌ JSON配置文件存在但解析失败:', error);
    }
    return getDefaultConfig();
  }
}

/**
 * 保存配置到文件
 */
export function saveServerSiteConfig(config: SiteConfig): void {
  const dockerConfigPath = '/app/config/site.config.json';
  const localConfigPath = path.resolve(process.cwd(), 'config/site.config.json');
  
  let configPath = localConfigPath;
  let isDockerConfig = false;
  
  // 在生产环境中，优先保存到挂载的配置
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.dirname(dockerConfigPath))) {
    configPath = dockerConfigPath;
    isDockerConfig = true;
    console.log('💾 保存配置到Docker挂载目录:', dockerConfigPath);
  } else {
    console.log('💾 保存配置到本地目录:', localConfigPath);
    
    // 确保本地配置目录存在
    const configDir = path.dirname(localConfigPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  }
  
  try {
    // 确保配置完整性
    const completeConfig = ensureConfigCompleteness(config);
    
    // 写入JSON文件，格式化输出
    const configData = JSON.stringify(completeConfig, null, 2);
    fs.writeFileSync(configPath, configData, 'utf-8');
    
    console.log('✅ 配置保存成功:', configPath);
  } catch (error) {
    console.error('❌ 配置保存失败:', error);
    throw new Error(`保存配置失败: ${error}`);
  }
}

/**
 * 验证配置数据
 */
export function validateSiteConfig(config: Partial<SiteConfig>): string[] {
  const errors: string[] = [];
  
  if (!config.title?.trim()) {
    errors.push('站点标题不能为空');
  }
  
  if (!config.description?.trim()) {
    errors.push('站点描述不能为空');
  }
  
  if (!config.author?.name?.trim()) {
    errors.push('作者姓名不能为空');
  }
  
  if (!config.author?.email?.trim()) {
    errors.push('作者邮箱不能为空');
  } else {
    // 支持邮箱和 mailto: 链接格式
    const email = config.author.email;
    const isMailtoFormat = email.startsWith('mailto:');
    const emailToValidate = isMailtoFormat ? email.substring(7) : email;
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailToValidate)) {
      errors.push('作者邮箱格式不正确');
    }
  }
  
  if (!config.url?.trim()) {
    errors.push('站点URL不能为空');
  } else if (config.url && !/^https?:\/\/.+/.test(config.url)) {
    errors.push('站点URL格式不正确，需要包含http://或https://');
  }
  
  if (config.postsPerPage && (config.postsPerPage < 1 || config.postsPerPage > 50)) {
    errors.push('每页文章数应在1-50之间');
  }
  
  if (config.excerptLength && (config.excerptLength < 50 || config.excerptLength > 500)) {
    errors.push('摘要长度应在50-500字符之间');
  }
  
  // 验证导航项
  if (config.nav) {
    config.nav.forEach((item, index) => {
      if (!item.name?.trim()) {
        errors.push(`导航项 ${index + 1} 的名称不能为空`);
      }
      if (!item.href?.trim()) {
        errors.push(`导航项 ${index + 1} 的链接不能为空`);
      }
    });
  }
  
  return errors;
}

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
