<script setup lang="ts">
import type { Forum, ForumCategory, Moderator, AuthUser } from '../../types';

defineProps<{
  forumStructure: ForumCategory[];
  communityAccount: string;
  communityInfo: { title?: string; about?: string };
  moderators: Moderator[];
  structureNote: boolean;
  loading: boolean;
  auth: { user: AuthUser | null };
  canEditStructure: boolean;
  explorationExpanded: boolean;
  explorationForm: { forums: Forum[]; loading: boolean };
  communityRewards: { blurt: string; vesting: string; hasRewards: boolean };
  t: (k: string) => string;
  timeAgo: (s: string) => string;
  forumHasUnread: (f: Forum) => boolean;
}>();

const emit = defineEmits<{
  openForum: [forum: Forum];
  openProfile: [username: string];
  startEditStructure: [];
  toggleExploration: [];
  'update:showStructureDocs': [value: boolean];
  claimCommunityRewards: [];
}>();
</script>

<template>
    <div >

      <div v-if="communityInfo.about" class="alert alert-info" style="margin-bottom:15px">
        <b>{{ communityInfo.title || communityAccount }}</b>: {{ communityInfo.about }}
      </div>

      <div v-if="structureNote" class="alert alert-info" style="margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          {{ t('usingDefaultStructure') }}
          <br><span class="gs">{{ t('structureHint') }}</span>
        </div>
        <button class="btn btn-sm btn-ghost" @click="emit('update:showStructureDocs', true)">ℹ️ {{ t('structureDocs') }}</button>
      </div>

      <div class="forumline-wrap" v-for="cat in forumStructure" :key="cat.name">
      <table class="forumline index-table">
        <thead>
          <tr><td colspan="4" class="catHead">{{ cat.name }}</td></tr>
          <tr>
            <td colspan="2" class="thHead" style="text-align:left;padding-left:15px">{{ t('forum') }}</td>
            <td class="thHead" width="220" align="center">{{ t('lastPost') }}</td>
          </tr>
        </thead>
        <tbody>
          <tr v-for="forum in cat.forums" :key="forum.id" class="row-hover" @click="emit('openForum', forum)" 
              :style="{ opacity: forum.posts.length === 0 && !forum.hasMore ? 0.7 : 1 }">
            <td class="row1" width="40" align="center" style="position:relative">
              <span v-if="forumHasUnread(forum)" style="font-size:20px; color:var(--accent);"><i class="fa-solid fa-folder-open"></i></span>
              <span v-else style="font-size:18px; opacity:0.5;"><i class="fa-solid fa-folder"></i></span>
              <span v-if="forumHasUnread(forum)"
                    style="position:absolute;top:6px;right:6px;width:8px;height:8px;background:var(--accent);border-radius:50%;border:1px solid #fff;display:block;box-shadow:0 0 4px rgba(0,0,0,0.2);"></span>
            </td>
            <td class="row1">
              <a :href="'?community=' + communityAccount + '&view=forum&forum=' + forum.id" @click.stop.prevent="emit('openForum', forum)"
                 :style="{ fontSize: forum.posts.length === 0 && !forum.hasMore ? '11px' : '13px', fontWeight: forumHasUnread(forum) ? 'bold' : 'normal' }">{{ forum.name }}</a><br>
              <span v-if="forum.targetTags.length > 0" class="gs">{{ t('tags') }}: {{ forum.targetTags.join(', ') }}</span>
              <span v-if="forum.desc" class="gs"> — {{ forum.desc }}</span>
            </td>
            <td class="row1" align="center">
              <template v-if="forum.posts.length>0">
                <span class="gs">{{ timeAgo(forum.posts[0].lastActivity) }}<br>
                <a :href="'?view=profile&user=' + (forum.posts[0].lastAuthor || forum.posts[0].author)" @click.stop.prevent="emit('openProfile', forum.posts[0].lastAuthor || forum.posts[0].author)">@{{ forum.posts[0].lastAuthor || forum.posts[0].author }}</a></span>
              </template>
              <div v-else-if="loading" class="spin" style="width:16px; height:16px; border-width:2px; margin:0 auto;"></div>
              <span v-else class="gs" style="color:var(--text-soft);">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

      <!-- MODERATORS SECTION -->
      <div v-if="moderators.length>0" class="mods-section">
        <div class="mods-header" style="display:flex; justify-content:space-between; align-items:center;">
          <span>{{ t('communityTeam') }}: {{ communityAccount }}</span>
          
          <div style="display:flex; gap:10px; align-items:center;">
            <!-- COMMUNITY REWARDS -->
            <div v-if="canEditStructure && communityRewards.hasRewards" 
                 class="community-reward-badge" 
                 @click="emit('claimCommunityRewards')"
                 :title="t('claimRewards')">
              🎁 {{ communityRewards.blurt }} / {{ communityRewards.vesting }}
            </div>

            <button v-if="canEditStructure" class="btn btn-accent btn-sm" @click="emit('startEditStructure')">{{ t('editStructure') }}</button>
          </div>
        </div>
        <div class="mods-body">
          <div v-for="m in moderators.filter(m => m.role !== 'muted')" :key="m.account" class="mod-badge">
            <span><a :href="'?view=profile&user=' + m.account" @click.prevent="emit('openProfile', m.account)">@{{ m.account }}</a></span>
            <span class="mod-role" :style="{color: ['owner', 'admin'].includes(m.role) ? 'var(--alert-error-text)' : 'var(--mod-role-text)'}">{{ m.role }}</span>
          </div>
        </div>
      </div>

      <!-- EXPLORATION SECTION -->
      <div class="forumline-wrap" style="margin-top: 20px;">
      <table class="forumline index-table">
        <thead>
          <tr>
            <td colspan="3" class="catHead">
              <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
                <span>{{ t('exploration') }}</span>
                <button class="btn btn-sm btn-ghost" @click="emit('toggleExploration')" style="padding: 2px 6px; font-size: 9px;">
                  {{ explorationExpanded ? t('hide') : t('show') }}
                </button>
              </div>
            </td>
          </tr>
        </thead>
        <tbody v-if="explorationExpanded">
          <tr>
            <td colspan="2" class="thHead" style="text-align:left;padding-left:15px">{{ t('forum') }}</td>
            <td class="thHead" width="220" align="center">{{ t('lastPost') }}</td>
          </tr>
          <tr v-for="vf in explorationForm.forums" :key="vf.id" 
              v-show="!vf.auth || auth.user"
              class="row-hover" @click="emit('openForum', vf)">
            <td class="row1" width="40" align="center">
              <span style="font-size:18px; opacity:0.7;"><i class="fa-solid fa-earth-americas"></i></span>
            </td>
            <td class="row1">
              <a :href="'?view=forum&forum=' + vf.id" @click.stop.prevent="emit('openForum', vf)" style="font-weight: bold;">{{ t(vf.nameKey ?? '') }}</a>
            </td>
            <td class="row1" align="center">
              <template v-if="vf.posts && vf.posts.length > 0">
                <span class="gs">{{ timeAgo(vf.posts[0].lastActivity) }}<br>
                <a :href="'?view=profile&user=' + (vf.posts[0].lastAuthor || vf.posts[0].author)" @click.stop.prevent="emit('openProfile', vf.posts[0].lastAuthor || vf.posts[0].author)">@{{ vf.posts[0].lastAuthor || vf.posts[0].author }}</a></span>
              </template>
              <div v-else-if="explorationForm.loading" class="spin" style="width:16px; height:16px; border-width:2px; margin:0 auto;"></div>
              <span v-else class="gs" style="color:var(--text-soft);">—</span>
            </td>
          </tr>
        </tbody>
      </table>
      </div>

    

 
    </div>
</template>

<style scoped>
.mods-section { margin-top: 25px; }
/* Colors/background come from the global .mods-header/.mods-body/.mod-badge/.mod-role
   theme styles; this component only overrides the badge layout (stacked, not a chip row). */
.mods-body { display: flex; flex-wrap: wrap; gap: 15px; }
.mod-badge { flex-direction: column; gap: 2px; }
.mod-badge a { text-decoration: none; font-size: 12px; }
.mod-role { opacity: 0.8; }

.community-reward-badge {
  background: var(--brand);
  color: #fff;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: bold;
  cursor: pointer;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  transition: transform 0.2s, background 0.2s;
}
.community-reward-badge:hover {
  background: var(--state-active);
  transform: scale(1.05);
}

.index-table { width: 100%; margin-top: 15px }
.row-hover:hover { background: var(--table-row-hover-bg); cursor: pointer; }


/* ===== Moved from global style.css (component-specific) ===== */
/* ===== MODS SECTION ===== */
.mods-section {
  background: var(--mods-bg);
  border: 1px solid var(--mods-border);
  margin: 15px 0;
  border-radius: var(--radius-md);
  overflow: hidden;
}
.mods-header { background: var(--mods-header-bg); color: var(--mods-header-text); padding: 8px 14px; font-weight: bold; text-transform: uppercase; font-size: 12px; }
.mods-body { padding: 10px; display: flex; flex-wrap: wrap; gap: 8px; }
.mod-badge {
  background: var(--mod-badge-bg);
  border: 1px solid var(--mod-badge-border);
  padding: 6px 12px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.mod-role { font-size: 10px; text-transform: uppercase; font-weight: bold; color: var(--mod-role-text); }
 
</style>
