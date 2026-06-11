<template>
  <div class="icon-picker-wrapper">
    <div v-if="modelValue" class="icon-picker-preview">
      <i :class="modelValue" style="font-size:24px;color:var(--primary-color,#667eea)"></i>
      <button class="icon-picker-clear" type="button" @click="$emit('update:modelValue', '')">&times;</button>
    </div>
    <input v-model="search" type="text" class="icon-picker-search" placeholder="搜索图标...">
    <div class="icon-picker-grid">
      <span
        v-for="ic in filteredIcons"
        :key="ic"
        class="icon-picker-option"
        :class="{ active: modelValue === ic }"
        @click="$emit('update:modelValue', modelValue === ic ? '' : ic)"
      ><i :class="ic"></i></span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue?: string
}>()

defineEmits<{
  'update:modelValue': [value: string]
}>()

const search = ref('')

const allIcons = [
  'ri-folder-3-line', 'ri-folder-line', 'ri-folder-star-line', 'ri-code-s-slash-line', 'ri-quill-pen-line', 'ri-lightbulb-line', 'ri-book-open-line', 'ri-chat-3-line', 'ri-image-line', 'ri-tools-line', 'ri-database-2-line', 'ri-rocket-line',
  'ri-folder-2-line', 'ri-folder-4-line', 'ri-folder-5-line', 'ri-folder-6-line', 'ri-folder-add-line', 'ri-folder-chart-line', 'ri-folder-check-line', 'ri-folder-close-line', 'ri-folder-download-line', 'ri-folder-history-line', 'ri-folder-info-line', 'ri-folder-keyhole-line',
  'ri-folder-lock-line', 'ri-folder-minus-line', 'ri-folder-open-line', 'ri-folder-received-line', 'ri-folder-reduce-line', 'ri-folder-settings-line', 'ri-folder-shared-line', 'ri-folder-shield-2-line', 'ri-folder-shield-line', 'ri-folder-transfer-line', 'ri-folder-upload-line', 'ri-folder-voice-line',
  'ri-bookmark-line', 'ri-bookmark-2-line', 'ri-bookmark-3-line', 'ri-bookmark-4-line', 'ri-bookmark-5-line', 'ri-bookmark-6-line', 'ri-bookmark-fill',
  'ri-file-line', 'ri-file-2-line', 'ri-file-3-line', 'ri-file-4-line', 'ri-file-5-line', 'ri-file-6-line', 'ri-file-add-line', 'ri-file-chart-line', 'ri-file-check-line', 'ri-file-close-line', 'ri-file-code-line', 'ri-file-copy-line',
  'ri-file-download-line', 'ri-file-edit-line', 'ri-file-excel-2-line', 'ri-file-excel-line', 'ri-file-forbid-line', 'ri-file-history-line', 'ri-file-info-line', 'ri-file-list-2-line', 'ri-file-list-3-line', 'ri-file-list-line', 'ri-file-lock-line', 'ri-file-mark-line',
  'ri-file-paper-2-line', 'ri-file-paper-line', 'ri-file-pdf-2-line', 'ri-file-pdf-line', 'ri-file-ppt-2-line', 'ri-file-ppt-line', 'ri-file-reduce-line', 'ri-file-search-line', 'ri-file-seed-line', 'ri-file-settings-line', 'ri-file-shield-2-line', 'ri-file-shield-line',
  'ri-file-text-line', 'ri-file-transfer-line', 'ri-file-unlock-line', 'ri-file-upload-line', 'ri-file-video-line', 'ri-file-word-2-line', 'ri-file-word-line', 'ri-file-zip-line',
  'ri-code-line', 'ri-code-box-line', 'ri-braces-line', 'ri-braces-check-line', 'ri-braces-unclamp-line', 'ri-terminal-box-line', 'ri-terminal-line', 'ri-command-line', 'ri-terminal-window-line', 'ri-html5-line', 'ri-css3-line', 'ri-javascript-line', 'ri-python-line',
  'ri-chat-1-line', 'ri-chat-2-line', 'ri-chat-4-line', 'ri-chat-smile-2-line', 'ri-chat-smile-3-line', 'ri-chat-quote-line', 'ri-chat-follow-up-line', 'ri-chat-poll-line', 'ri-chat-private-line', 'ri-chat-thread-line', 'ri-chat-voice-line',
  'ri-message-2-line', 'ri-message-3-line', 'ri-mail-line', 'ri-mail-send-line', 'ri-mail-check-line', 'ri-mail-close-line', 'ri-mail-download-line', 'ri-mail-open-line', 'ri-mail-unread-line',
  'ri-instagram-line', 'ri-wechat-line', 'ri-qq-line', 'ri-weibo-line', 'ri-twitter-x-line', 'ri-facebook-circle-line', 'ri-youtube-line', 'ri-bilibili-line', 'ri-telegram-line', 'ri-github-line', 'ri-twitch-line', 'ri-discord-line',
  'ri-plant-line', 'ri-seedling-line', 'ri-leaf-line', 'ri-sun-line', 'ri-moon-line', 'ri-cloudy-line', 'ri-rainy-line', 'ri-flashlight-line', 'ri-fire-line', 'ri-drop-line', 'ri-windy-line', 'ri-snowflake-line', 'ri-temperature-hot-line', 'ri-temperature-cold-line',
  'ri-heart-line', 'ri-heart-2-line', 'ri-heart-3-line', 'ri-heart-pulse-line', 'ri-hand-heart-line', 'ri-mental-health-line', 'ri-body-scan-line', 'ri-pulse-line',
  'ri-stethoscope-line', 'ri-microscope-line', 'ri-medicine-bottle-line', 'ri-syringe-line', 'ri-pill-line', 'ri-hospital-line', 'ri-thermometer-line', 'ri-bandage-line', 'ri-eye-line', 'ri-ear-line', 'ri-nose-line', 'ri-tooth-line', 'ri-brain-line', 'ri-hand-line',
  'ri-finger-heart-line', 'ri-run-line', 'ri-walk-line', 'ri-dumbbell-line', 'ri-basketball-line', 'ri-football-line', 'ri-tennis-line', 'ri-pokemon-line',
  'ri-mountain-line', 'ri-compass-3-line', 'ri-map-2-line', 'ri-road-map-line',
  'ri-goblet-line', 'ri-cup-line', 'ri-goblet-full-line', 'ri-restaurant-line', 'ri-restaurant-2-line', 'ri-cake-3-line', 'ri-cake-2-line', 'ri-cake-line', 'ri-cake-5-line', 'ri-cake-4-line', 'ri-coffee-line', 'ri-mug-line', 'ri-wine-line', 'ri-beer-line',
  'ri-earth-line', 'ri-earthquake-line', 'ri-world-line', 'ri-planet-line', 'ri-meteor-line', 'ri-space-ship-line', 'ri-rocket-2-line', 'ri-satellite-line',
  'ri-star-line', 'ri-star-2-line', 'ri-star-3-line', 'ri-star-half-line', 'ri-medal-2-line', 'ri-medal-line', 'ri-trophy-line', 'ri-award-line',
  'ri-quill-pen-circle-line', 'ri-pencil-ruler-2-line', 'ri-pencil-ruler-line', 'ri-pencil-line', 'ri-paint-brush-line', 'ri-palette-line', 'ri-magic-line', 'ri-brush-2-line', 'ri-brush-3-line', 'ri-eraser-line', 'ri-clip-line', 'ri-scissors-cut-line', 'ri-ruler-line', 'ri-ruler-2-line', 'ri-compass-line', 'ri-drafting-compass-line',
  'ri-video-line', 'ri-video-chat-line', 'ri-film-line', 'ri-movie-2-line', 'ri-movie-line', 'ri-music-2-line', 'ri-music-line', 'ri-mv-line', 'ri-headphone-line', 'ri-mic-line', 'ri-record-circle-line', 'ri-play-circle-line', 'ri-pause-circle-line', 'ri-stop-circle-line', 'ri-skip-forward-line', 'ri-skip-back-line', 'ri-volume-down-line', 'ri-volume-mute-line', 'ri-volume-up-line',
  'ri-timer-line', 'ri-timer-2-line', 'ri-timer-flash-line', 'ri-alarm-line', 'ri-alarm-flash-line', 'ri-watch-line', 'ri-time-line',
  'ri-dashboard-3-line', 'ri-dashboard-2-line', 'ri-dashboard-line', 'ri-tachometer-line', 'ri-speed-line', 'ri-gauge-line', 'ri-percent-line',
  'ri-scales-3-line', 'ri-scales-line', 'ri-scales-2-line', 'ri-balance-line',
  'ri-shield-check-line', 'ri-shield-star-line', 'ri-shield-2-line', 'ri-shield-line', 'ri-shield-cross-line', 'ri-shield-keyhole-line', 'ri-shield-flash-line', 'ri-shield-risk-line', 'ri-shield-user-line',
  'ri-lock-line', 'ri-lock-2-line', 'ri-lock-password-line', 'ri-unlock-line', 'ri-unlock-2-line', 'ri-key-2-line', 'ri-key-line', 'ri-keyboard-line',
  'ri-capsule-line', 'ri-tablet-line', 'ri-phone-line', 'ri-phone-find-line', 'ri-phone-lock-line', 'ri-sim-card-line', 'ri-sim-card-2-line', 'ri-contacts-line',
  'ri-user-line', 'ri-user-2-line', 'ri-user-3-line', 'ri-user-4-line', 'ri-user-5-line', 'ri-user-6-line', 'ri-user-add-line', 'ri-user-follow-line', 'ri-user-heart-line', 'ri-user-location-line', 'ri-user-received-line', 'ri-user-search-line', 'ri-user-settings-line', 'ri-user-shared-line', 'ri-user-smile-line', 'ri-user-star-line', 'ri-user-unfollow-line',
  'ri-group-line', 'ri-group-2-line', 'ri-group-3-line', 'ri-team-line', 'ri-people-line',
  'ri-robot-line', 'ri-robot-2-line', 'ri-robot-3-line', 'ri-ai-generate', 'ri-bard-line', 'ri-openai-line',
]

const filteredIcons = computed(() => {
  const q = search.value.toLowerCase().trim()
  if (!q) return allIcons
  return allIcons.filter(ic => ic.toLowerCase().includes(q))
})
</script>

<style scoped>
.icon-picker-wrapper { display: flex; flex-direction: column; gap: 8px; }
.icon-picker-preview { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 8px; }
.icon-picker-clear { background: none; border: none; font-size: 18px; cursor: pointer; color: #999; }
.icon-picker-search { padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 8px; font-size: 13px; outline: none; }
.icon-picker-search:focus { border-color: #667eea; }
.icon-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(32px, 1fr)); gap: 4px; max-height: 180px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; }
.icon-picker-option { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px; border: 1.5px solid transparent; cursor: pointer; font-size: 16px; color: #555; transition: all 0.15s; }
.icon-picker-option:hover { border-color: #667eea; color: #667eea; background: rgba(102,126,234,0.05); }
.icon-picker-option.active { border-color: #667eea; background: rgba(102,126,234,0.1); color: #667eea; }
</style>
