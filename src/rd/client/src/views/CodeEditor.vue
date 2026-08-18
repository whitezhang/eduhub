<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = defineProps({ modelValue: { type: String, default: "" }, language: { type: String, default: "cpp" } });
const emit = defineEmits(["update:modelValue"]);
const el = ref(null);
let editor = null;
let monaco = null;

onMounted(async () => {
  const mod = await import("monaco-editor");
  monaco = mod;
  self.MonacoEnvironment = {
    getWorker: async () => {
      const { default: EditorWorker } = await import("monaco-editor/esm/vs/editor/editor.worker?worker");
      return new EditorWorker();
    },
  };
  editor = monaco.editor.create(el.value, {
    value: props.modelValue,
    language: props.language === "python" ? "python" : "cpp",
    theme: "vs",
    fontSize: 14,
    fontFamily: "IBM Plex Mono, ui-monospace, monospace",
    minimap: { enabled: false },
    automaticLayout: true,
    scrollBeyondLastLine: false,
  });
  editor.onDidChangeModelContent(() => emit("update:modelValue", editor.getValue()));
});

watch(
  () => props.language,
  (lang) => {
    if (editor && monaco) monaco.editor.setModelLanguage(editor.getModel(), lang === "python" ? "python" : "cpp");
  },
);
watch(
  () => props.modelValue,
  (v) => {
    if (editor && v !== editor.getValue()) editor.setValue(v);
  },
);

onBeforeUnmount(() => editor?.dispose());
</script>

<template>
  <div ref="el" style="height: 320px; border: 1px solid var(--rule)"></div>
</template>
