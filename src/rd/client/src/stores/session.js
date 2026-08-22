import { defineStore } from "pinia";
import { api } from "../api.js";

export const useSession = defineStore("session", {
  state: () => ({ user: null, ready: false, loginOpen: false, profileOpen: false }),
  actions: {
    async refresh() {
      const data = await api("/api/session");
      this.user = data.user;
      this.ready = true;
    },
    openLogin() {
      this.loginOpen = true;
    },
    closeLogin() {
      this.loginOpen = false;
    },
    openProfile() {
      this.profileOpen = true;
    },
    closeProfile() {
      this.profileOpen = false;
    },
    async login(username, password) {
      const data = await api("/api/login", { method: "POST", body: { username, password } });
      this.user = data.user;
      this.loginOpen = false;
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
