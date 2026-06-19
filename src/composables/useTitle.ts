import { reactive, ref, watch } from 'vue';

const titleIcons = reactive<Record<string, string>>({});
const pageTitleText = ref('BlurtForum');

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

  const setPageTitle = (title: string | null) => {
    pageTitleText.value = title ? `${title} - BlurtForum` : 'BlurtForum';
  };

  // This should be called once in the root component (App.vue)
  const initTitleWatcher = () => {
    watch([titleIcons, pageTitleText], () => {
      const prefix = Object.values(titleIcons).join('');
      document.title = (prefix ? prefix + ' ' : '') + pageTitleText.value;
    }, { deep: true, immediate: true });
  };

  return { setTitleIcon, titleIcons, setPageTitle, initTitleWatcher };
}
