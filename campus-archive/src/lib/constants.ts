// 上传限制与常量
export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

export const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export const CERTIFICATE_LEVELS = [
  "国际级",
  "国家级",
  "省级",
  "市级",
  "校级",
  "院级",
  "其他",
] as const;

export const MAIN_CATEGORY_KEYS = [
  "identity",
  "certificate",
  "experience",
  "photo",
  "portfolio",
] as const;

export const SUBCATEGORY_KEYS = [
  // 身份证件 (8)
  "identity-idcard",
  "identity-student",
  "identity-household",
  "identity-residence",
  "identity-birth",
  "identity-passport",
  "identity-license",
  "identity-bankcard",
  // 证书 (4)
  "certificate-award",
  "certificate-qualify",
  "certificate-level",
  "certificate-graduation",
  // 经历证明 (4)
  "experience-intern",
  "experience-volunteer",
  "experience-social",
  "experience-club",
  // 活动照片 (4)
  "photo-competition",
  "photo-volunteer",
  "photo-ceremony",
  "photo-daily",
  // 作品集 (4)
  "portfolio-design",
  "portfolio-code",
  "portfolio-writing",
  "portfolio-other",
] as const;

export function isValidAccount(account: string): "phone" | "email" | null {
  if (/^1[3-9]\d{9}$/.test(account)) return "phone";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) return "email";
  return null;
}
