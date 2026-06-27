export function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

export function encodeSlug(slug: string): string {
  return encodeURIComponent(decodeSlug(slug));
}
