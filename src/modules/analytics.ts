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
    (window as any).gtag('config', 'G-66P34PGTQF', {
      page_path: path,
      page_title: title,
      ...additionalParams
    });
  }
};
