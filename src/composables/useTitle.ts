import { reactive, watch } from 'vue';

const titleIcons = reactive<Record<string, string>>({});

/**
 * Composable for managing the document title with dynamic prefix icons.
 * Shared state allows any component/composable to register an icon.
 */
export function useTitle() {
  const setTitleIcon = (key: string, icon: string | null) => {
    if (icon === null) {
      delete titleIcons[key];
    } else {
      titleIcons[key] = icon;
    }
  };

  // This should be called once in the root component (App.vue)
  const initTitleWatcher = () => {
    watch(titleIcons, (icons) => {
      const prefix = Object.values(icons).join('');
      document.title = (prefix ? prefix + ' ' : '') + 'BlurtForum';
    }, { deep: true, immediate: true });
  };

  return { setTitleIcon, titleIcons, initTitleWatcher };
}
