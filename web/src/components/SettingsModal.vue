<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import AppIcon from './AppIcon.vue';
import { api } from '../api';
import { refreshSystem, state, toast } from '../store';

const emit = defineEmits<{ (event: 'close'): void }>();

const current = state.settings;
const form = reactive({
  downloadDir: current?.downloadDir ?? '',
  concurrency: current?.concurrency ?? 2,
  fragmentConcurrency: current?.fragmentConcurrency ?? 4,
  maxPlaylistItems: current?.maxPlaylistItems ?? 300,
  organizeByProvider: current?.organizeByProvider ?? true,
  cookie: '',
  ffmpegPath: current?.ffmpegPath ?? '',
  ytdlpPath: current?.ytdlpPath ?? '',
  pythonPath: current?.pythonPath ?? '',
});

const clearCookie = ref(false);
const saving = ref(false);
const checking = ref(false);

async function save(): Promise<void> {
  if (!form.downloadDir.trim()) {
    toast('请填写下载目录', 'error');
    return;
  }
  saving.value = true;
  try {
    const patch: Record<string, unknown> = {
      downloadDir: form.downloadDir,
      concurrency: form.concurrency,
      fragmentConcurrency: form.fragmentConcurrency,
      maxPlaylistItems: form.maxPlaylistItems,
      organizeByProvider: form.organizeByProvider,
      ffmpegPath: form.ffmpegPath,
      ytdlpPath: form.ytdlpPath,
      pythonPath: form.pythonPath,
    };
    if (clearCookie.value) patch.clearCookie = true;
    if (form.cookie.trim()) patch.cookie = form.cookie.trim();

    const result = await api.saveSettings(patch);
    state.settings = result.settings;
    state.system = result.system;
    state.queue = result.system.queue;
    toast('设置已保存', 'success');
    emit('close');
  } catch (error) {
    toast(error instanceof Error ? error.message : '保存失败', 'error');
  } finally {
    saving.value = false;
  }
}

async function recheck(): Promise<void> {
  checking.value = true;
  try {
    await refreshSystem();
  } finally {
    checking.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close');
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="modal-backdrop" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="设置">
      <div class="modal-head">
        <div>
          <h2>设置</h2>
          <p>下载目录、并发与站点登录信息，只保存在本机</p>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </div>

      <div class="modal-body">
        <div class="settings-section">
          <h3>下载与并发</h3>
          <div class="settings-grid">
            <div class="field full">
              <label for="download-dir">下载目录</label>
              <input id="download-dir" v-model="form.downloadDir" class="input" spellcheck="false" />
              <span class="hint">绝对路径；目录不存在会自动创建。默认在项目下的 downloads/。</span>
            </div>
            <div class="field">
              <label for="concurrency">同时下载任务数</label>
              <input id="concurrency" v-model.number="form.concurrency" class="input" type="number" min="1" max="6" />
              <span class="hint">1–6，建议 2–3，太高容易触发站点限流。</span>
            </div>
            <div class="field">
              <label for="fragments">单任务分片并发</label>
              <input
                id="fragments"
                v-model.number="form.fragmentConcurrency"
                class="input"
                type="number"
                min="1"
                max="16"
              />
              <span class="hint">DASH 分片并发数，B 站建议 4 左右。</span>
            </div>
            <div class="field">
              <label for="max-items">单个链接最多展开</label>
              <input id="max-items" v-model.number="form.maxPlaylistItems" class="input" type="number" min="1" max="500" />
              <span class="hint">合集 / 收藏夹的最大条目数，预览和直接入队都使用这个值（1–500）。</span>
            </div>
            <div class="field" style="justify-content: flex-end">
              <label class="check">
                <input v-model="form.organizeByProvider" type="checkbox" />
                按平台分文件夹
              </label>
              <span class="hint">例如 downloads/bilibili/ 与 downloads/generic/。</span>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>B 站登录（可选）</h3>
          <p class="section-note">
            登录后可下载 1080P+ / 4K、大会员内容、私享收藏夹和 CC / AI 字幕。获取方式：登录 B 站 → 开发者工具 →
            Network → 任意请求 → 请求头 Cookie，整段复制粘贴到下面。弹幕不需要登录。
          </p>
          <p class="section-note">
            这里保存的是长期 B 站登录信息；只想给某一次任务使用，请用主界面的 Cookie 输入框。
          </p>
          <div class="cookie-row">
            <textarea
              v-model="form.cookie"
              class="input cookie-input"
              rows="3"
              spellcheck="false"
              autocomplete="off"
              :placeholder="
                current?.hasCookie
                  ? `已保存（${current.cookiePreview}），留空保持不变`
                  : 'SESSDATA=...; bili_jct=...; buvid3=...（整段 Cookie）或 cookies.txt 路径'
              "
              :disabled="clearCookie"
            ></textarea>
            <button
              v-if="current?.hasCookie"
              class="btn btn-sm"
              type="button"
              @click="clearCookie = !clearCookie"
            >
              {{ clearCookie ? '撤销清除' : '清除登录信息' }}
            </button>
          </div>
          <p class="hint">
            只填 SESSDATA 的值也可以，完整 Cookie 更稳定；也支持直接填 cookies.txt 路径。Cookie 以明文保存在本机
            <code>data/cookies.txt</code> 和 <code>data/state.json</code>，不会上传。
          </p>
          <p v-if="clearCookie" class="hint" style="color: var(--warn)">
            保存后将删除本地已保存的登录信息。
          </p>
        </div>

        <div class="settings-section">
          <h3>引擎路径（高级）</h3>
          <p class="section-note">
            留空时自动探测：优先使用 yt-dlp 可执行文件，其次使用 ./yt-dlp 源码 + Python。ffmpeg 用于合并 DASH 音视频。
          </p>
          <div class="settings-grid">
            <div class="field">
              <label for="ffmpeg-path">ffmpeg 路径</label>
              <input
                id="ffmpeg-path"
                v-model="form.ffmpegPath"
                class="input"
                spellcheck="false"
                placeholder="自动探测 tools/ffmpeg 或 PATH"
              />
            </div>
            <div class="field">
              <label for="ytdlp-path">yt-dlp 可执行文件</label>
              <input
                id="ytdlp-path"
                v-model="form.ytdlpPath"
                class="input"
                spellcheck="false"
                placeholder="例如 D:\tools\yt-dlp.exe"
              />
            </div>
            <div class="field">
              <label for="python-path">Python 解释器</label>
              <input
                id="python-path"
                v-model="form.pythonPath"
                class="input"
                spellcheck="false"
                placeholder="使用 ./yt-dlp 源码时填写"
              />
            </div>
            <div class="field" style="justify-content: flex-end">
              <button class="btn btn-sm btn-ghost" type="button" :disabled="checking" @click="recheck">
                <AppIcon name="refresh" :size="13" :class="{ spin: checking }" />
                重新检测
              </button>
            </div>
          </div>
        </div>

        <div class="settings-section">
          <h3>运行状态</h3>
          <div v-if="state.system" class="system-grid">
            <span class="k">yt-dlp</span>
            <span class="v">
              {{ state.system.ytdlp ? `${state.system.ytdlp.version}（${state.system.ytdlp.mode}）` : '未就绪' }}
            </span>
            <span class="k">ffmpeg</span>
            <span class="v">{{ state.system.ffmpeg ? state.system.ffmpeg.version : '未找到' }}</span>
            <span class="k">下载目录</span>
            <span class="v">{{ state.system.dirs.downloadDir }}</span>
            <span class="k">Node</span>
            <span class="v">{{ state.system.runtime.node }}</span>
          </div>

          <div v-if="state.system && !state.system.ok" class="warning-box error" style="margin-top: 12px">
            <AppIcon name="alert" :size="15" style="flex: none; margin-top: 2px" />
            <span>{{ state.system.error }}</span>
          </div>
          <div v-else-if="state.system && !state.system.ffmpeg" class="warning-box" style="margin-top: 12px">
            <AppIcon name="alert" :size="15" style="flex: none; margin-top: 2px" />
            <span>
              未检测到 ffmpeg。B 站高清视频是音视频分离的 DASH 流，缺少 ffmpeg 无法合并。可把 ffmpeg.exe 放到
              <code>tools/ffmpeg/bin/</code>，或安装后在上方填写路径。
            </span>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <span class="spacer"></span>
        <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
        <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </div>
  </div>
</template>
