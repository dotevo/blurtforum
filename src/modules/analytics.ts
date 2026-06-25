const cleanTitle = (title: string): string => {
  return title
    .replace(/^\(\d+\)\s*/, '')
    .replace(/[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu, '')
    .trim();
};

export const trackEvent = (action: string, category: string, label?: string, value?: number) => {
  if (typeof (window as any).gtag === 'function') {
    (window as any).gtag('event', action, {
      event_category: category,
      event_label: label,
      value: value
    });
  }
};

export const trackPageView = (path: string, title: string, additionalParams: Record<string, any> = {}) => {
  if (typeof (window as any).gtag === 'function') {
    const sanitizedTitle = cleanTitle(title);
    console.log(sanitizedTitle);
    (window as any).gtag('config', 'G-66P34PGTQF', {
      page_path: path,
      page_title: sanitizedTitle,
      ...additionalParams
    });
  }
};
