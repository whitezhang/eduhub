import { defineStore } from "pinia";
import { api } from "../api.js";

export const useSession = defineStore("session", {
  state: () => ({
    user: null,
    ready: false,
    loginOpen: false,
    profileOpen: false,
    loginReturnTo: "",
  }),
  actions: {
    async refresh() {
      const data = await api("/api/session", { skipGuard: true });
      this.user = data.user;
      this.ready = true;
    },
    openLogin(returnTo = "") {
      this.loginReturnTo = returnTo || "";
      this.loginOpen = true;
    },
    closeLogin() {
      this.loginOpen = false;
      this.loginReturnTo = "";
    },
    openProfile() {
      this.profileOpen = true;
    },
    closeProfile() {
      this.profileOpen = false;
    },
    async login(username, password) {
      const data = await api("/api/login", { method: "POST", body: { username, password }, skipGuard: true });
      this.user = data.user;
      this.loginOpen = false;
      const dest = this.loginReturnTo;
      this.loginReturnTo = "";
      if (dest) {
        const { default: router } = await import("../router.js");
        await router.push(dest);
      }
    },
    async updateDisplayName(display_name) {
      const data = await api("/api/session", {
        method: "PATCH",
        body: { display_name },
      });
      this.user = data.user;
      this.profileOpen = false;
    },
    async logout() {
      await api("/api/logout", { method: "POST", body: {} });
      this.user = null;
    },
  },
});
