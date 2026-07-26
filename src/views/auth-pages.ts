import { layout } from "./layout";

export function signupPage(inviteUrl: string): string {
  const body = `
  <div class="max-w-md mx-auto mt-16">
    <div class="bg-panel border border-panel2 rounded-2xl p-8">
      <h1 class="text-2xl font-bold mb-1">Create your account</h1>
      <p class="text-gray-400 text-sm mb-6">
        Members-only — you'll need to be in our Discord to sign up.
      </p>

      <form action="/auth/discord/login" method="get" class="space-y-4">
        <div>
          <label class="block text-sm text-gray-300 mb-1">Name</label>
          <input name="name" required
            class="w-full bg-panel2 border border-panel2 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-accent">
        </div>
        <div>
          <label class="block text-sm text-gray-300 mb-1">Email</label>
          <input name="email" type="email" required
            class="w-full bg-panel2 border border-panel2 rounded-lg px-3 py-2 text-gray-100 focus:outline-none focus:border-accent">
        </div>
        <button type="submit"
          class="w-full flex items-center justify-center gap-2 bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg px-4 py-3 transition-colors">
          Continue with Discord
        </button>
      </form>

      <p class="text-xs text-gray-500 mt-6 text-center">
        Not in the server yet? <a href="${inviteUrl}" class="text-accent hover:underline">Join here</a> first.
      </p>
    </div>
  </div>`;

  return layout("Sign up", body);
}

export function notInDiscordPage(inviteUrl: string): string {
  const body = `
  <div class="max-w-md mx-auto mt-24 text-center">
    <div class="bg-panel border border-panel2 rounded-2xl p-8">
      <h1 class="text-2xl font-bold mb-2">Almost there</h1>
      <p class="text-gray-400 mb-6">
        This app is only available to members of our Discord server.
      </p>
      <a href="${inviteUrl}"
        class="inline-block bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium rounded-lg px-6 py-3 transition-colors">
        Join the Discord
      </a>
      <p class="text-xs text-gray-500 mt-6">
        Once you've joined, come back and sign up again.
      </p>
    </div>
  </div>`;

  return layout("Join our Discord", body);
}
