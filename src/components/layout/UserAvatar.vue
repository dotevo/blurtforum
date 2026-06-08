<script setup lang="ts">
const props = defineProps<{
  username: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  anon?: boolean;
  round?: boolean;
}>();

const emit = defineEmits<{
  click: [username: string];
}>();

const getAvatarUrl = (user: string, sz: number) => {
  if (!user) return '';
  return `https://imgp.blurt.blog/profileimage/${user}/${sz}x${sz}`;
};

const pixelSize = {
  xs: 64,
  sm: 128,
  md: 128,
  lg: 128
}[props.size || 'md'];

</script>

<template>
  <div class="avatar" 
       :class="['avatar-' + (size || 'md'), { 'is-round': round }]"
       :style="{ backgroundImage: username ? `url(${getAvatarUrl(username, pixelSize)})` : '' }"
       @click="emit('click', username)">
  </div>
</template>

<style scoped>
.avatar {
  background-size: cover;
  background-position: center;
  background-color: var(--bg-r2);
  border-radius: 4px;
  flex-shrink: 0;
}
.avatar.is-round {
  border-radius: 50%;
}
.avatar-xs { width: 32px; height: 32px; }
.avatar-sm { width: 48px; height: 48px; }
.avatar-md { width: 64px; height: 64px; }
.avatar-lg { width: 128px; height: 128px; }
</style>
