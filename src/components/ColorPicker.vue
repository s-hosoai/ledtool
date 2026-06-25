<template>
  <div class="color-picker" :class="{ disabled }">
    <!-- カラースウォッチ -->
    <div class="swatch" :style="swatchStyle">
      <span v-if="disabled" class="swatch-x">×</span>
    </div>

    <!-- HSV スライダー -->
    <div class="slider-group">
      <span class="lbl">H</span>
      <input type="range" min="0" max="360" step="1"
        :value="Math.round(hsv.h)" :disabled="disabled"
        :style="hueTrack"
        @input="onH" class="slider" />
      <input type="number" min="0" max="360"
        :value="Math.round(hsv.h)" :disabled="disabled"
        @change="onH" class="num" />
    </div>
    <div class="slider-group">
      <span class="lbl">S</span>
      <input type="range" min="0" max="100" step="1"
        :value="Math.round(hsv.s * 100)" :disabled="disabled"
        :style="satTrack"
        @input="onS" class="slider" />
    </div>
    <div class="slider-group">
      <span class="lbl">V</span>
      <input type="range" min="0" max="100" step="1"
        :value="Math.round(hsv.v * 100)" :disabled="disabled"
        :style="valTrack"
        @input="onV" class="slider" />
    </div>

    <div class="sep" />

    <!-- RGB 数値入力 -->
    <div class="rgb-group">
      <span class="lbl">R</span>
      <input type="number" min="0" max="255"
        :value="modelValue.r" :disabled="disabled"
        @change="onR" class="num" />
    </div>
    <div class="rgb-group">
      <span class="lbl">G</span>
      <input type="number" min="0" max="255"
        :value="modelValue.g" :disabled="disabled"
        @change="onG" class="num" />
    </div>
    <div class="rgb-group">
      <span class="lbl">B</span>
      <input type="number" min="0" max="255"
        :value="modelValue.b" :disabled="disabled"
        @change="onB" class="num" />
    </div>

    <div class="sep" />

    <!-- HEX -->
    <div class="hex-group">
      <span class="lbl">#</span>
      <input type="text" maxlength="6"
        :value="hexValue" :disabled="disabled"
        @change="onHex" class="hex" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Object, default: () => ({ r: 0, g: 0, b: 0 }) },
  disabled: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue'])

// 内部HSV状態（HとSを保持するため、RGB真値から逆算しない）
// S・Vは初期値を最大にしておき、Hスライダーだけで色が出るようにする
const hsv = ref({ h: 0, s: 1, v: 1 })

// 外部から modelValue が変わったとき（別セル選択など）に HSV を更新
watch(() => props.modelValue, (val) => {
  const cur = hsvToRgb(hsv.value.h, hsv.value.s, hsv.value.v)
  if (cur.r !== val.r || cur.g !== val.g || cur.b !== val.b) {
    hsv.value = rgbToHsv(val.r, val.g, val.b)
  }
}, { deep: true })

// ---- スライダーのトラック色 ----
const hueTrack = { background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }

const satTrack = computed(() => {
  const h = hsv.value.h
  return { background: `linear-gradient(to right,#888,hsl(${h},100%,50%))` }
})
const valTrack = computed(() => {
  const h = hsv.value.h
  return { background: `linear-gradient(to right,#000,hsl(${h},100%,50%))` }
})
const swatchStyle = computed(() => {
  if (props.disabled) return { background: '#2a2a2a' }
  const { r, g, b } = props.modelValue
  return { background: `rgb(${r},${g},${b})` }
})

const hexValue = computed(() => {
  const { r, g, b } = props.modelValue
  return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
})

// ---- イベントハンドラ ----
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }

function emitRgb() {
  emit('update:modelValue', hsvToRgb(hsv.value.h, hsv.value.s, hsv.value.v))
}

function onH(e) {
  hsv.value = { ...hsv.value, h: clamp(Number(e.target.value), 0, 360) }
  emitRgb()
}
function onS(e) {
  hsv.value = { ...hsv.value, s: clamp(Number(e.target.value) / 100, 0, 1) }
  emitRgb()
}
function onV(e) {
  hsv.value = { ...hsv.value, v: clamp(Number(e.target.value) / 100, 0, 1) }
  emitRgb()
}
function onR(e) {
  const rgb = { ...props.modelValue, r: clamp(Number(e.target.value), 0, 255) }
  hsv.value = rgbToHsv(rgb.r, rgb.g, rgb.b)
  emit('update:modelValue', rgb)
}
function onG(e) {
  const rgb = { ...props.modelValue, g: clamp(Number(e.target.value), 0, 255) }
  hsv.value = rgbToHsv(rgb.r, rgb.g, rgb.b)
  emit('update:modelValue', rgb)
}
function onB(e) {
  const rgb = { ...props.modelValue, b: clamp(Number(e.target.value), 0, 255) }
  hsv.value = rgbToHsv(rgb.r, rgb.g, rgb.b)
  emit('update:modelValue', rgb)
}
function onHex(e) {
  const hex = e.target.value.replace(/[^0-9a-fA-F]/g, '').padEnd(6, '0').slice(0, 6)
  const n = parseInt(hex, 16)
  const rgb = { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff }
  hsv.value = rgbToHsv(rgb.r, rgb.g, rgb.b)
  emit('update:modelValue', rgb)
}

// ---- 色変換 ----
function hsvToRgb(h, s, v) {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60)       { r=c; g=x; b=0 }
  else if (h < 120) { r=x; g=c; b=0 }
  else if (h < 180) { r=0; g=c; b=x }
  else if (h < 240) { r=0; g=x; b=c }
  else if (h < 300) { r=x; g=0; b=c }
  else              { r=c; g=0; b=x }
  return { r: Math.round((r+m)*255), g: Math.round((g+m)*255), b: Math.round((b+m)*255) }
}

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else                h = ((r - g) / d + 4) / 6
  }
  return { h: h * 360, s: max === 0 ? 0 : d / max, v: max }
}
</script>

<style scoped>
.color-picker {
  display: flex;
  align-items: center;
  gap: 6px;
}

.color-picker.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.swatch {
  width: 24px;
  height: 24px;
  border-radius: 3px;
  border: 1px solid #555;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.swatch-x {
  color: #666;
  font-size: 14px;
  line-height: 1;
}

.slider-group,
.rgb-group {
  display: flex;
  align-items: center;
  gap: 3px;
}

.hex-group {
  display: flex;
  align-items: center;
  gap: 3px;
}

.lbl {
  font-size: 11px;
  color: #888;
  width: 12px;
  text-align: center;
  flex-shrink: 0;
}

.slider {
  -webkit-appearance: none;
  appearance: none;
  width: 72px;
  height: 10px;
  border-radius: 5px;
  outline: none;
  cursor: pointer;
  flex-shrink: 0;
}

.slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid #888;
  cursor: pointer;
}

.num {
  width: 42px;
  background: #2a2a2a;
  color: #ddd;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 3px;
  font-size: 11px;
  text-align: center;
}

.hex {
  width: 64px;
  background: #2a2a2a;
  color: #ddd;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 2px 4px;
  font-size: 11px;
  font-family: monospace;
}

.sep {
  width: 1px;
  height: 20px;
  background: #444;
  flex-shrink: 0;
}

input[type="number"]::-webkit-inner-spin-button {
  opacity: 0.4;
}
</style>
