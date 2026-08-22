import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { NextRequest } from 'next/server';

const JWT_EXPIRES_IN = '24h';

/**
 * 读取JWT密钥
 * 缺失时直接抛错，避免生产环境静默降级为硬编码密钥
 * 在调用时（而非模块加载时）校验，保证构建阶段不依赖运行时环境变量
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.trim() === '') {
    throw new Error('JWT_SECRET 未配置，请在环境变量中设置足够随机的密钥后再启动服务');
  }
  return secret;
}

/**
 * 读取管理员密码
 * 缺失时直接抛错，避免生产环境静默降级为默认弱口令
 */
function getAdminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.trim() === '') {
    throw new Error('ADMIN_PASSWORD 未配置，请在环境变量中设置管理员密码后再启动服务');
  }
  return password;
}

/**
 * 定长时间字符串比较，避免通过响应耗时逐位试探密码
 */
function timingSafeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf-8');
  const bufferB = Buffer.from(b, 'utf-8');

  // 长度不同时仍与自身比较一次，保持耗时稳定
  if (bufferA.length !== bufferB.length) {
    crypto.timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

export interface JWTPayload {
  userId: string;
  role: 'admin';
  iat?: number;
  exp?: number;
}

/**
 * 生成JWT Token
 */
export function generateToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 验证JWT Token
 */
export function verifyToken(token: string): JWTPayload | null {
  // 密钥缺失属于配置错误，不能被当成“token无效”吞掉
  const secret = getJwtSecret();

  try {
    const payload = jwt.verify(token, secret) as JWTPayload;
    return payload;
  } catch (error) {
    console.error('JWT验证失败:', error);
    return null;
  }
}

/**
 * 从请求中提取JWT Token
 */
export function extractTokenFromRequest(request: NextRequest): string | null {
  // 首先检查Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // 然后检查cookies
  const token = request.cookies.get('admin-token')?.value;
  return token || null;
}

/**
 * 验证管理员密码
 */
export function verifyAdminPassword(password: string): boolean {
  return timingSafeEqual(password, getAdminPassword());
}

/**
 * 生成安全的管理员Token
 */
export function generateAdminToken(): string {
  return generateToken({
    userId: 'admin',
    role: 'admin'
  });
}