export const normalizeAppRoute = (path = '/') => {
  const raw = String(path || '/').trim();

  if (!raw || raw === '#') return '/';

  const withoutHash = raw.startsWith('#') ? raw.slice(1) : raw;
  return withoutHash.startsWith('/') ? withoutHash : `/${withoutHash}`;
};

export const buildAppUrl = (path = '/') => {
  const route = normalizeAppRoute(path);
  const { origin, pathname, search } = window.location;
  const basePath = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const safeBase = basePath && basePath !== '/' ? basePath : '';

  return `${origin}${safeBase}${search ? '' : ''}/#${route}`;
};

export const goToAppRoute = (path = '/') => {
  window.location.href = buildAppUrl(path);
};
