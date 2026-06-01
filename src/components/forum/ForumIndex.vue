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

      <table class="forumline index-table" v-for="cat in forumStructure" :key="cat.name">
        <tr><td colspan="4" class="catHead">{{ cat.name }}</td></tr>
        <tr>
          <td colspan="2" class="thHead" style="text-align:left;padding-left:15px">{{ t('forum') }}</td>
          <td class="thHead" width="220" align="center">{{ t('lastPost') }}</td>
        </tr>
        <tr v-for="forum in cat.forums" :key="forum.id" class="row-hover" @click="emit('openForum', forum)" 
            :style="{ opacity: forum.posts.length === 0 && !forum.hasMore ? 0.7 : 1 }">
          <td class="row1" width="40" align="center" style="position:relative">
            <span v-if="forumHasUnread(forum)" style="font-size:20px; color:var(--accent);"><i class="fa-solid fa-folder-open"></i></span>
            <span v-else style="font-size:18px; opacity:0.5;"><i class="fa-solid fa-folder"></i></span>
            <span v-if="forumHasUnread(forum)"
                  style="position:absolute;top:6px;right:6px;width:8px;height:8px;background:#ff4400;border-radius:50%;border:1px solid #fff;display:block;box-shadow:0 0 4px rgba(0,0,0,0.2);"></span>
          </td>
          <td class="row1">
            <a href="#" @click.stop.prevent="emit('openForum', forum)"
               :style="{ fontSize: forum.posts.length === 0 && !forum.hasMore ? '11px' : '13px', fontWeight: forumHasUnread(forum) ? 'bold' : 'normal' }">{{ forum.name }}</a><br>
            <span v-if="forum.targetTags.length > 0" class="gs">{{ t('tags') }}: {{ forum.targetTags.join(', ') }}</span>
            <span v-if="forum.desc" class="gs"> — {{ forum.desc }}</span>
          </td>
          <td class="row1" align="center">
            <template v-if="forum.posts.length>0">
              <span class="gs">{{ timeAgo(forum.posts[0].lastActivity) }}<br>
              <a href="#" @click.stop.prevent="emit('openProfile', forum.posts[0].lastAuthor || forum.posts[0].author)">@{{ forum.posts[0].lastAuthor || forum.posts[0].author }}</a></span>
            </template>
            <div v-else-if="loading" class="spin" style="width:16px; height:16px; border-width:2px; margin:0 auto;"></div>
            <span v-else class="gs" style="color:var(--text-muted);">—</span>
          </td>
        </tr>
      </table>

      <!-- MODERATORS SECTION -->
      <div v-if="moderators.length>0" class="mods-section">
        <div class="mods-header" style="display:flex; justify-content:space-between; align-items:center;">
          <span>{{ t('communityTeam') }}: {{ communityAccount }}</span>
          <button v-if="canEditStructure" class="btn btn-accent btn-sm" @click="emit('startEditStructure')">{{ t('editStructure') }}</button>
        </div>
        <div class="mods-body">
          <div v-for="m in moderators" :key="m.account" class="mod-badge">
            <span><a href="#" @click.prevent="emit('openProfile', m.account)">@{{ m.account }}</a></span>
            <span class="mod-role" :style="{color: ['owner', 'admin'].includes(m.role) ? '#e74c3c' : 'var(--primary)'}">{{ m.role }}</span>
          </div>
        </div>
      </div>

      <!-- EXPLORATION SECTION -->
      <table class="forumline index-table" style="margin-top: 20px;">
        <tr>
          <td colspan="3" class="catHead">
            <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
              <span>{{ t('exploration') }}</span>
              <button class="btn btn-sm btn-ghost" @click="emit('toggleExploration')" style="padding: 2px 6px; font-size: 9px; color: var(--primary); border-color: var(--primary); background: var(--bg-white);">
                {{ explorationExpanded ? t('hide') : t('show') }}
              </button>
            </div>
          </td>
        </tr>
        <template v-if="explorationExpanded">
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
              <a href="#" @click.stop.prevent="emit('openForum', vf)" style="font-weight: bold;">{{ t(vf.nameKey ?? '') }}</a>
            </td>
            <td class="row1" align="center">
              <template v-if="vf.posts && vf.posts.length > 0">
                <span class="gs">{{ timeAgo(vf.posts[0].lastActivity) }}<br>
                <a href="#" @click.stop.prevent="emit('openProfile', vf.posts[0].lastAuthor || vf.posts[0].author)">@{{ vf.posts[0].lastAuthor || vf.posts[0].author }}</a></span>
              </template>
              <div v-else-if="explorationForm.loading" class="spin" style="width:16px; height:16px; border-width:2px; margin:0 auto;"></div>
              <span v-else class="gs" style="color:var(--text-muted);">—</span>
            </td>
          </tr>
        </template>
      </table>

    

 
    </div>
</template>
