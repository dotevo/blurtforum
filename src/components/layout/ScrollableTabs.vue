<template>
  <div class="scrollable-tabs-wrapper" 
       ref="container"
       :class="{ dragging: isDragging, 'has-left': showLeftFade, 'has-right': showRightFade }"
       @mousedown="startDragging"
       @mousemove="onDragging"
       @mouseup="stopDragging"
       @mouseleave="stopDragging"
       @scroll="checkScroll"
  >
    <div class="scrollable-tabs-content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue';

const container = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const startX = ref(0);
const scrollLeft = ref(0);
const hasMoved = ref(false);

const showLeftFade = ref(false);
const showRightFade = ref(false);

const checkScroll = () => {
  if (!container.value) return;
  const { scrollLeft: sLeft, scrollWidth, clientWidth } = container.value;
  showLeftFade.value = sLeft > 10;
  showRightFade.value = sLeft + clientWidth < scrollWidth - 10;
};

const startDragging = (e: MouseEvent) => {
  if (!container.value) return;
  isDragging.value = true;
  hasMoved.value = false;
  startX.value = e.pageX - container.value.offsetLeft;
  scrollLeft.value = container.value.scrollLeft;
};

const stopDragging = (e: MouseEvent) => {
  if (!isDragging.value) return;
  isDragging.value = false;
  
  if (hasMoved.value) {
    const clickHandler = (event: MouseEvent) => {
      event.stopImmediatePropagation();
      container.value?.removeEventListener('click', clickHandler, true);
    };
    container.value?.addEventListener('click', clickHandler, true);
  }
};

const onDragging = (e: MouseEvent) => {
  if (!isDragging.value || !container.value) return;
  e.preventDefault();
  const x = e.pageX - container.value.offsetLeft;
  const walk = (x - startX.value);
  if (Math.abs(walk) > 5) {
    hasMoved.value = true;
  }
  container.value.scrollLeft = scrollLeft.value - walk;
};

const onWheel = (e: WheelEvent) => {
  if (!container.value) return;
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
    container.value.scrollLeft += e.deltaY;
    e.preventDefault();
  }
};

onMounted(() => {
  container.value?.addEventListener('wheel', onWheel, { passive: false });
  nextTick(checkScroll);
  window.addEventListener('resize', checkScroll);
});

onUnmounted(() => {
  container.value?.removeEventListener('wheel', onWheel);
  window.removeEventListener('resize', checkScroll);
});

</script>

<style scoped>
.scrollable-tabs-wrapper {
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  -ms-overflow-style: none;
  cursor: grab;
  user-select: none;
  display: flex;
  flex: 1;
  min-width: 0;
  position: relative;
  mask-image: linear-gradient(to right, 
    transparent, 
    black 0%, 
    black 100%, 
    transparent);
  transition: mask-image 0.3s;
}

.scrollable-tabs-wrapper.has-left {
  mask-image: linear-gradient(to right, 
    transparent, 
    black 40px, 
    black 100%, 
    transparent);
}

.scrollable-tabs-wrapper.has-right {
  mask-image: linear-gradient(to right, 
    transparent, 
    black 0%, 
    black calc(100% - 40px), 
    transparent);
}

.scrollable-tabs-wrapper.has-left.has-right {
  mask-image: linear-gradient(to right, 
    transparent, 
    black 40px, 
    black calc(100% - 40px), 
    transparent);
}

.scrollable-tabs-wrapper::-webkit-scrollbar {
  display: none;
}

.scrollable-tabs-wrapper.dragging {
  cursor: grabbing;
}

.scrollable-tabs-content {
  display: flex;
  flex-direction: row;
}

.scrollable-tabs-wrapper :deep(button),
.scrollable-tabs-wrapper :deep(a) {
  -webkit-user-drag: none;
  user-select: none;
}
</style>
