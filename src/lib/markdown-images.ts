const imageExtensionPattern = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const externalUrlPattern = /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i;

interface MarkdownNode {
  type?: string;
  url?: string;
  children?: MarkdownNode[];
}

function splitUrlSuffix(url: string): { pathname: string; suffix: string } {
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');
  const suffixIndex = [queryIndex, hashIndex]
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0];

  if (suffixIndex === undefined) {
    return { pathname: url, suffix: '' };
  }

  return {
    pathname: url.slice(0, suffixIndex),
    suffix: url.slice(suffixIndex),
  };
}

function toImageApiUrl(imagePath: string, suffix: string): string {
  const normalizedPath = imagePath
    .replace(/\\/g, '/')
    .split('/')
    .filter(segment => segment && segment !== '.')
    .join('/');

  return normalizedPath ? `/api/images/${normalizedPath}${suffix}` : imagePath;
}

export function normalizeMarkdownImageUrl(url: string): string {
  const trimmedUrl = url.trim();

  if (
    !trimmedUrl ||
    externalUrlPattern.test(trimmedUrl) ||
    trimmedUrl.startsWith('/api/images/')
  ) {
    return url;
  }

  const { pathname, suffix } = splitUrlSuffix(trimmedUrl);
  const normalizedPath = pathname.replace(/\\/g, '/');
  const segments = normalizedPath
    .split('/')
    .filter(segment => segment && segment !== '.');
  const imagesIndex = segments.findIndex(segment => segment === 'images');
  const contentImagesIndex = segments.findIndex(
    (segment, index) => segment === 'content' && segments[index + 1] === 'images'
  );

  if (contentImagesIndex >= 0) {
    return toImageApiUrl(segments.slice(contentImagesIndex + 2).join('/'), suffix);
  }

  if (imagesIndex >= 0) {
    return toImageApiUrl(segments.slice(imagesIndex + 1).join('/'), suffix);
  }

  if (segments.length === 1 && imageExtensionPattern.test(segments[0])) {
    return toImageApiUrl(segments[0], suffix);
  }

  if (!trimmedUrl.startsWith('/') && imageExtensionPattern.test(normalizedPath)) {
    return toImageApiUrl(segments.filter(segment => segment !== '..').join('/'), suffix);
  }

  return url;
}

function visitMarkdownImages(node: MarkdownNode): void {
  if (node.type === 'image' && typeof node.url === 'string') {
    node.url = normalizeMarkdownImageUrl(node.url);
  }

  node.children?.forEach(visitMarkdownImages);
}

export function normalizeRemarkImages() {
  return (tree: MarkdownNode) => {
    visitMarkdownImages(tree);
  };
}
