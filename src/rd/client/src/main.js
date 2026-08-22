import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router.js";
import { bindSessionStore } from "./api.js";
import { useSession } from "./stores/session.js";
import "./styles.css";

const pinia = createPinia();
const app = createApp(App);
app.use(pinia);
app.use(router);
bindSessionStore(useSession());
app.mount("#app");