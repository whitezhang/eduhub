import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../../api.js";

export function useSyllabus() {
  const route = useRoute();
  const router = useRouter();
  const cms = ref(null);
  const err = ref("");
  const loading = ref(true);

  const track = computed(() => String(route.query.track || "csp-j"));
  const item = computed(() => (cms.value?.syllabus || []).find((s) => s.slug === track.value) || null);
  const tracks = computed(() => cms.value?.syllabus || []);

  async function load() {
    loading.value = true;
    err.value = "";
    try {
      cms.value = await api("/api/cms");
    } catch (e) {
      err.value = e.message;
      cms.value = null;
    } finally {
      loading.value = false;
    }
  }

  function setTrack(slug) {
    router.push({ path: route.path, query: { ...route.query, track: slug } });
  }

  onMounted(load);
  watch(
    () => [cms.value, track.value],
    () => {
      if (!cms.value?.syllabus?.length) return;
      if (!cms.value.syllabus.some((s) => s.slug === track.value)) {
        setTrack(cms.value.syllabus[0].slug);
      }
    },
  );

  return { cms, err, loading, track, item, tracks, setTrack, load };
}

export function importanceStars(n) {
  const v = Math.max(0, Math.min(5, Number(n) || 0));
  if (!v) return "—";
  return "★".repeat(v);
}

export function examFlag(on) {
  return on ? "✓" : "—";
}
