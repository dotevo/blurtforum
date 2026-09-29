<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import ScrollableTabs from '../../modules/ui/ScrollableTabs.vue';
import { isTVPlatform } from '../../modules/native/platform-info';

const props = defineProps<{
  theme: string;
  themes: { id: string; label: string }[];
  lang: string;
  langs: string[];
  t: (k: string) => string;
  mobile?: boolean;
  /** Vertical stacked layout (full-width rows, icon + label), for use inside
   *  a narrow side rail instead of a horizontal top bar. */
  rail?: boolean;
  cinemaMode: boolean;
}>();

const emit = defineEmits<{
  'setTheme': [value: string];
  'setLang': [value: string];
  'openRpc': [];
  'setCinemaMode': [value: boolean];
}>();

/**
 * Mobile-only icon pickers for theme/lang (see the `v-if="mobile"` branch
 * in the template below). Real bug this replaces: on mobile, `mobile` only
 * ever hid the "Theme:"/"Lang:" LABEL text next to the selects (`v-if=
 * "!mobile"` on those spans) -- the native <select> itself still always
 * displays the full current option text ("🏛 Classic", "Polski", etc, up
 * to a CSS `max-width: 84px` that doesn't even reliably truncate a native
 * select's own rendering across mobile browsers). In
 * MobileTopBar.vue's drawer, this sits in the same flex row as the
 * logout/switch-account buttons (`.mtb-lang-bar { flex: 1 }` next to
 * `.mtb-auth-actions`) -- wide select boxes there were pushing logout
 * off/out of comfortable tap range, matching the reported "can't tap
 * logout" bug.
 *
 * Fix: on mobile, theme/lang render as a single icon button (current
 * value not shown at all when closed) that opens a small menu listing
 * every option BY NAME -- i.e. the name only appears while actively
 * choosing, never as part of the always-visible bar. Desktop/rail keep
 * the plain <select> exactly as before (unchanged) -- both already show
 * their current value inline there, which is fine since there's room.
 */
/**
 * Real bug found after the icon-picker fix above shipped: on mobile, the
 * menu's `openMenu` state WAS toggling correctly, but nothing visibly
 * happened -- because .icon-picker-menu (`position: absolute`) is a
 * descendant of ScrollableTabs' `.scrollable-tabs-wrapper`, which needs
 * `overflow-x: auto` for the horizontal tab-scroll it exists for, and per
 * the CSS overflow spec, that wrapper ALSO sets `overflow-y: hidden`
 * (needed together to avoid an unwanted vertical scrollbar) -- which
 * silently clips ANY descendant that tries to render outside the
 * wrapper's own box, popup menu included. It was opening -- just
 * invisible, clipped to nothing.
 *
 * Fix: Teleport the menu to <body> and position it with real viewport
 * coordinates from the trigger button's own getBoundingClientRect(),
 * instead of `position: absolute` relative to a clipped ancestor. Same
 * fix shape as WebtorrentAudioSubtitleMenu.vue used earlier for the same
 * category of bug (something needing to render outside a container that's
 * clipping/scrolling for an unrelated reason).
 */
const menuStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' });
const openMenu = ref<'theme' | 'lang' | null>(null);
const menuBtnEls: Record<string, HTMLElement | null> = { theme: null, lang: null };
function setMenuBtnEl(which: 'theme' | 'lang', el: unknown): void {
  menuBtnEls[which] = (el as HTMLElement | null) ?? null;
}
function updateMenuStyle(which: 'theme' | 'lang'): void {
  const btn = menuBtnEls[which];
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  menuStyle.value = { top: (r.bottom + 4) + 'px', left: Math.max(4, r.left) + 'px' };
}
function toggleMenu(which: 'theme' | 'lang'): void {
  const opening = openMenu.value !== which;
  openMenu.value = opening ? which : null;
  if (opening) updateMenuStyle(which);
}
function pickTheme(id: string): void {
  emit('setTheme', id);
  openMenu.value = null;
}
function pickLang(code: string): void {
  emit('setLang', code);
  openMenu.value = null;
}
function langLabel(l: unknown): string {
  const asAny = l as { code?: string; name?: string } | string;
  if (typeof asAny === 'string') return asAny.toUpperCase();
  return asAny.name || (asAny.code || '').toUpperCase();
}
function langCode(l: unknown): string {
  const asAny = l as { code?: string } | string;
  return typeof asAny === 'string' ? asAny : (asAny.code || '');
}
function currentThemeIcon(): string {
  const t = props.themes.find(x => x.id === props.theme);
  // Theme labels are "<emoji> <Name>" (see useApp.ts's `themes` list) --
  // just the emoji, so the closed button has *some* visual identity
  // without needing the full name.
  return t ? t.label.split(' ')[0] : '🎨';
}

function onDocClick(e: MouseEvent): void {
  if (!openMenu.value) return;
  const target = e.target as HTMLElement;
  if (!target.closest('.icon-picker') && !target.closest('.icon-picker-menu')) openMenu.value = null;
}
function onScrollOrResize(): void {
  if (openMenu.value) openMenu.value = null;
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  window.addEventListener('resize', onScrollOrResize);
  window.addEventListener('scroll', onScrollOrResize, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('resize', onScrollOrResize);
  window.removeEventListener('scroll', onScrollOrResize, true);
});
</script>

<template>
  <!-- Rail (vertical side-nav): plain stacked list, never needs horizontal scrolling. -->
  <div v-if="rail" class="settings-selectors is-rail">
    <div class="selector-item">
      <i class="fa-solid fa-palette"></i>
      <span class="gs">{{ t('theme') }}:</span>
      <select :value="theme" @change="emit('setTheme', ($event.target as HTMLSelectElement).value)" class="lang-btn" :aria-label="t('theme')">
        <option v-for="th in themes" :key="th.id" :value="th.id">{{ th.label }}</option>
      </select>
    </div>
    <div class="selector-item">
      <i class="fa-solid fa-language"></i>
      <span class="gs">{{ t('lang') }}:</span>
      <select :value="lang" @change="emit('setLang', ($event.target as HTMLSelectElement).value)" class="lang-btn" :aria-label="t('lang')">
        <option v-for="l in (langs as any)" :key="l.code || l" :value="l.code || l">{{ l.name || l.toUpperCase() }}</option>
      </select>
    </div>
    <button class="lang-btn rpc-btn" @click="emit('openRpc')" :title="t('rpcSettings')">
      <i class="fa-solid fa-gear"></i> <span>{{ t('rpc') }}</span>
    </button>
    <button v-if="!isTVPlatform" class="lang-btn rpc-btn cinema-btn" :class="{ active: cinemaMode }"
            @click="emit('setCinemaMode', !cinemaMode)" :title="t('cinemaMode') || 'Cinema mode'">
      <i class="fa-solid fa-film"></i> <span>{{ t('cinemaMode') || 'Cinema' }}</span>
    </button>
  </div>

  <!-- Top-bar layout: items keep their natural width and, if they don't all
       fit (mainly on narrow phones), the row scrolls horizontally with a
       drag/fade affordance instead of squeezing or overflowing off-screen —
       the same pattern used for the player's tabs. -->
  <ScrollableTabs v-else class="settings-selectors-scroll">
    <div class="settings-selectors" :class="{ 'is-mobile': mobile }">
      <template v-if="mobile">
        <div class="icon-picker">
          <button :ref="(el) => setMenuBtnEl('theme', el)" class="lang-btn icon-picker-btn" @click.stop="toggleMenu('theme')" :title="t('theme')">
            {{ currentThemeIcon() }}
          </button>
        </div>
        <div class="icon-picker">
          <button :ref="(el) => setMenuBtnEl('lang', el)" class="lang-btn icon-picker-btn" @click.stop="toggleMenu('lang')" :title="t('lang')">
            <i class="fa-solid fa-language"></i>
          </button>
        </div>
        <Teleport to="body">
          <div v-if="openMenu === 'theme'" class="icon-picker-menu" :style="menuStyle" @click.stop>
            <button v-for="th in themes" :key="th.id" class="icon-picker-option" :class="{ active: th.id === theme }"
                    @click.stop="pickTheme(th.id)">
              {{ th.label }}
            </button>
          </div>
          <div v-if="openMenu === 'lang'" class="icon-picker-menu" :style="menuStyle" @click.stop>
            <button v-for="l in (langs as any)" :key="langCode(l)" class="icon-picker-option" :class="{ active: langCode(l) === lang }"
                    @click.stop="pickLang(langCode(l))">
              {{ langLabel(l) }}
            </button>
          </div>
        </Teleport>
      </template>
      <template v-else>
        <div class="selector-item">
          <i class="fa-solid fa-palette"></i>
          <span class="gs">{{ t('theme') }}:</span>
          <select :value="theme" @change="emit('setTheme', ($event.target as HTMLSelectElement).value)" class="lang-btn" :aria-label="t('theme')">
            <option v-for="th in themes" :key="th.id" :value="th.id">{{ th.label }}</option>
          </select>
        </div>
        <div class="selector-item">
          <i class="fa-solid fa-language"></i>
          <span class="gs">{{ t('lang') }}:</span>
          <select :value="lang" @change="emit('setLang', ($event.target as HTMLSelectElement).value)" class="lang-btn" :aria-label="t('lang')">
            <option v-for="l in (langs as any)" :key="l.code || l" :value="l.code || l">{{ l.name || l.toUpperCase() }}</option>
          </select>
        </div>
      </template>
      <button class="lang-btn rpc-btn" @click="emit('openRpc')" :title="t('rpcSettings')">
        <i class="fa-solid fa-gear"></i> <span v-if="!mobile">{{ t('rpc') }}</span>
      </button>
      <button v-if="!isTVPlatform" class="lang-btn rpc-btn cinema-btn" :class="{ active: cinemaMode }"
              @click="emit('setCinemaMode', !cinemaMode)" :title="t('cinemaMode') || 'Cinema mode'">
        <i class="fa-solid fa-film"></i> <span v-if="!mobile">{{ t('cinemaMode') || 'Cinema' }}</span>
      </button>
    </div>
  </ScrollableTabs>
</template>

<style scoped>
/* The ScrollableTabs wrapper sizes itself to the available space in its
   flex parent (LangBar / MobileTopBar drawer) and handles overflow. */
.settings-selectors-scroll {
  width: 100%;
}

.settings-selectors {
  display: flex;
  gap: 10px;
  align-items: center;
}

.selector-item {
  display: flex;
  gap: 5px;
  align-items: center;
  flex-shrink: 0;
}

.selector-item i {
  font-size: 12px;
  color: var(--brand);
}

.lang-btn {
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  color: var(--text-strong);
  padding: 2px 6px;
  font-size: 11px;
  cursor: pointer;
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-weight: bold;
  outline: none;
}

.lang-btn:hover {
  border-color: var(--brand);
  background: var(--surface-2);
}

.rpc-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.cinema-btn.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

/* Mobile: items keep a comfortable, tappable minimum size instead of being
   squeezed — if they don't all fit, the surrounding ScrollableTabs lets the
   row scroll horizontally (with drag + fade edges) instead. */
.is-mobile {
  gap: 8px;
}

.is-mobile .rpc-btn {
  padding: 6px 10px;
  background: var(--surface-nav);
  border: 1px solid var(--surface-border);
}

.is-mobile .cinema-btn.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}

/* Mobile icon pickers (theme/lang) — see this file's <script setup>
   comment on `openMenu` for the bug this replaces (native <select> always
   showing its full current value, crowding out the logout button next to
   it in MobileTopBar.vue's drawer row). Closed button shows only an
   icon/emoji, never the current value's name — the name only appears
   inside the open menu, i.e. only while actively choosing. */
.icon-picker {
  position: relative;
  flex-shrink: 0;
}
.icon-picker-btn {
  min-width: 34px;
  height: 34px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}
.icon-picker-menu {
  position: fixed;
  z-index: 10000; /* Teleported to body -- needs to clear .bfp-panel/.bfp-bar (999/1000) the same way other Teleported popups in this app do, see WebtorrentAudioSubtitleMenu.vue's own history with this exact class of z-index issue */
  min-width: 140px;
  max-height: 260px;
  overflow-y: auto;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
  display: flex;
  flex-direction: column;
  padding: 4px;
}
.icon-picker-option {
  background: transparent;
  border: none;
  color: var(--text-strong);
  text-align: left;
  padding: 8px 10px;
  font-size: 13px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  white-space: nowrap;
}
.icon-picker-option:hover {
  background: var(--surface-2);
}
.icon-picker-option.active {
  background: var(--brand);
  color: #fff;
}

/* Rail (vertical side-nav) layout: stacked full-width rows instead of a
   horizontal bar -- this is what a 72px-wide rail actually needs, the
   horizontal .is-mobile layout above was designed for a top bar and simply
   doesn't fit sideways. */
.is-rail {
  flex-direction: column;
  align-items: stretch;
  width: 100%;
  gap: 2px;
}
.is-rail .selector-item,
.is-rail .rpc-btn {
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 10px 22px;
  gap: 16px;
  justify-content: flex-start;
}
.is-rail .selector-item i,
.is-rail .rpc-btn i { font-size: 16px; width: 20px; text-align: center; }
.is-rail .selector-item:hover,
.is-rail .rpc-btn:hover { background: var(--surface-2); }
.is-rail .selector-item select:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--brand);
}
.is-rail .selector-item select {
  flex: 1;
  border: none;
  /* Not transparent: most browsers render the native option-list popup
     using the <select>'s own background-color. Leaving this transparent
     let it fall through to the OS default (usually light), while the text
     color here stays var(--text-strong) (light, for a dark theme) --
     giving light-on-light and making the open dropdown unreadable in
     cinema even though the closed box looked fine. The top-bar variant
     (.lang-btn below) already sets a real background for this reason. */
  background: var(--input-bg);
  color: var(--text-strong);
  font-size: 13px;
  padding: 0 4px;
  border-radius: var(--radius-sm);
}
.is-rail .cinema-btn.active { background: var(--brand); color: #fff; border-radius: var(--radius-sm); }
</style>
