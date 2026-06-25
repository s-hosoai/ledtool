<template>
  <div class="app">
    <!-- ヘッダー -->
    <header class="app-header">
      <div class="header-left">
        <span class="app-title">LED Pattern Editor</span>
        <input
          class="project-name"
          type="text"
          :value="project.name"
          @change="setProjectName($event.target.value)"
          title="プロジェクト名"
        />
      </div>
      <div class="header-controls">
        <label class="control-item">
          LED数
          <input
            type="number" min="1" max="256"
            :value="project.layout.led_count"
            @change="onLedCountChange($event)"
          />
        </label>
        <label class="control-item">
          FPS
          <input
            type="number" min="1" max="60"
            :value="project.pattern.fps"
            @change="setFps(Number($event.target.value))"
          />
        </label>
        <label class="control-item">
          ループ
          <input
            type="checkbox"
            :checked="project.pattern.loop"
            @change="setLoop($event.target.checked)"
          />
        </label>
        <div class="header-buttons">
          <button @click="newProject">新規</button>
          <button @click="saveProject">保存</button>
          <button @click="triggerLoad">読み込み</button>
          <input ref="fileInputRef" type="file" accept=".ledproj" style="display:none" @change="onFileLoad" />
        </div>
      </div>
    </header>

    <!-- エラーバナー -->
    <div v-if="errorMessage" class="error-banner">
      {{ errorMessage }}
      <button @click="clearError">✕</button>
    </div>

    <!-- メインエリア（左右分割） -->
    <div class="main-area" ref="mainAreaRef">
      <!-- 左：タイムラインエディタ -->
      <div class="pane pane-left" :style="{ width: leftWidth + 'px' }">
        <div class="pane-title">タイムライン</div>
        <TimelineEditor class="pane-content" />
      </div>

      <!-- ドラッグハンドル -->
      <div
        class="divider"
        @mousedown="startDividerDrag"
        title="ドラッグで幅を変更"
      />

      <!-- 右：シミュレーター -->
      <div class="pane pane-right">
        <div class="pane-title">シミュレーター</div>
        <Simulator class="pane-content" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onUnmounted } from 'vue'
import { useProject } from './composables/useProject.js'
import TimelineEditor from './components/TimelineEditor.vue'
import Simulator from './components/Simulator.vue'

const {
  project,
  setLedCount,
  setFps,
  setLoop,
  setProjectName,
  loadProject,
  saveProject,
  newProject,
  clearError,
} = useProject()

// errorMessage は useProject から直接取得（computed ref）

const fileInputRef = ref(null)

function onLedCountChange(e) {
  const v = parseInt(e.target.value)
  if (!isNaN(v)) setLedCount(v)
}

function triggerLoad() {
  fileInputRef.value.value = ''
  fileInputRef.value.click()
}

function onFileLoad(e) {
  const file = e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (ev) => loadProject(ev.target.result)
  reader.readAsText(file)
}

// 左右分割ドラッグ
const mainAreaRef = ref(null)
const leftWidth = ref(null)  // null = 50%
let isDragging = false
let dragStartX = 0
let dragStartWidth = 0

function startDividerDrag(e) {
  isDragging = true
  dragStartX = e.clientX
  dragStartWidth = leftWidth.value ?? mainAreaRef.value.offsetWidth / 2
  document.addEventListener('mousemove', onDividerMove)
  document.addEventListener('mouseup', stopDividerDrag)
  e.preventDefault()
}

function onDividerMove(e) {
  if (!isDragging || !mainAreaRef.value) return
  const totalW = mainAreaRef.value.offsetWidth - 6  // 6px = ハンドル幅
  const newW = Math.max(200, Math.min(totalW - 200, dragStartWidth + (e.clientX - dragStartX)))
  leftWidth.value = newW
}

function stopDividerDrag() {
  isDragging = false
  document.removeEventListener('mousemove', onDividerMove)
  document.removeEventListener('mouseup', stopDividerDrag)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDividerMove)
  document.removeEventListener('mouseup', stopDividerDrag)
})
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #111;
  color: #ddd;
  font-family: sans-serif;
  overflow: hidden;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 8px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-title {
  font-size: 14px;
  font-weight: bold;
  color: #fff;
  white-space: nowrap;
}

.project-name {
  background: #2a2a2a;
  color: #fff;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 8px;
  font-size: 13px;
  width: 200px;
}

.header-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.control-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #aaa;
}

.control-item input[type="number"] {
  width: 54px;
  background: #2a2a2a;
  color: #fff;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 12px;
}

.header-buttons {
  display: flex;
  gap: 6px;
}

.header-buttons button {
  padding: 3px 12px;
  background: #2d5a8e;
  color: #fff;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
}

.header-buttons button:hover {
  background: #3a6fa5;
}

.error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #7a1f1f;
  color: #fdd;
  font-size: 13px;
  flex-shrink: 0;
}

.error-banner button {
  background: none;
  border: none;
  color: #fdd;
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
}

.main-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.pane {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 200px;
}

.pane-right {
  flex: 1;
}

.pane-title {
  font-size: 11px;
  color: #666;
  padding: 3px 8px;
  background: #1a1a1a;
  border-bottom: 1px solid #2a2a2a;
  flex-shrink: 0;
  letter-spacing: 0.05em;
}

.pane-content {
  flex: 1;
  overflow: hidden;
}

.divider {
  width: 6px;
  background: #222;
  cursor: col-resize;
  flex-shrink: 0;
  border-left: 1px solid #333;
  border-right: 1px solid #333;
  transition: background 0.1s;
}

.divider:hover {
  background: #444;
}
</style>
