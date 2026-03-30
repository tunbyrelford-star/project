const { uploadAttachment, deleteUploadedAttachment } = require("../../../services/file");

function formatFileSize(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeExt(value) {
  return String(value || "").trim().toLowerCase().replace(/^\./, "");
}

function getFileExt(fileName = "") {
  const index = String(fileName).lastIndexOf(".");
  if (index < 0) return "";
  return normalizeExt(fileName.slice(index + 1));
}

function isRemotePath(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function looksLikeImage(fileName = "", mimeType = "") {
  const ext = getFileExt(fileName);
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic"].includes(ext)) return true;
  return /^image\//i.test(String(mimeType || ""));
}

function buildUid(index) {
  return `att_${Date.now()}_${index}_${Math.floor(Math.random() * 1e6)}`;
}

function pickFileName(pathValue, fallback = "附件") {
  const full = String(pathValue || "");
  const parts = full.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : fallback;
}

function toStatusText(status) {
  if (status === "uploading") return "上传中";
  if (status === "failed") return "上传失败";
  return "已上传";
}

function normalizeIncomingFiles(list) {
  return (list || [])
    .map((item, index) => {
      const pathValue = String(item.path || item.url || "").trim();
      const localPath = String(item.localPath || "").trim();
      const hasRemote = isRemotePath(pathValue);
      const hasLocal = Boolean(localPath) || (!hasRemote && Boolean(pathValue));
      if (!pathValue && !hasLocal) return null;

      const name = String(item.name || "").trim()
        || pickFileName(pathValue || localPath, `附件${index + 1}`);
      const status = item.status === "uploading" || item.status === "failed" ? item.status : "uploaded";
      const size = Number(item.size || 0);
      const key = String(item.key || "").trim();
      const mimeType = String(item.mimeType || "").trim();
      const effectiveLocalPath = localPath || (!hasRemote ? pathValue : "");

      return {
        id: String(item.id || buildUid(index)),
        name,
        path: hasRemote ? pathValue : (status === "uploaded" && !hasRemote ? pathValue : ""),
        localPath: effectiveLocalPath,
        size,
        sizeText: formatFileSize(size),
        key,
        mimeType,
        progress: Number(item.progress || (status === "uploaded" ? 100 : 0)),
        status,
        statusText: toStatusText(status),
        error: String(item.error || "").trim(),
        isImage: looksLikeImage(name, mimeType),
        uploadedByComponent: Boolean(item.uploadedByComponent)
      };
    })
    .filter(Boolean);
}

function isCancelError(error) {
  const msg = String((error && error.errMsg) || (error && error.message) || "").toLowerCase();
  return msg.includes("cancel");
}

function fileInfo(filePath) {
  return new Promise((resolve) => {
    if (!filePath || !wx.getFileSystemManager) {
      resolve({ size: 0 });
      return;
    }

    const fs = wx.getFileSystemManager();
    if (!fs || typeof fs.getFileInfo !== "function") {
      resolve({ size: 0 });
      return;
    }

    fs.getFileInfo({
      filePath,
      success: (res) => resolve({ size: Number((res && res.size) || 0) }),
      fail: () => resolve({ size: 0 })
    });
  });
}

Component({
  properties: {
    value: {
      type: Array,
      value: []
    },
    maxCount: {
      type: Number,
      value: 6
    },
    readonly: {
      type: Boolean,
      value: false
    },
    title: {
      type: String,
      value: "附件"
    },
    accept: {
      type: String,
      value: "file"
    },
    uploadCategory: {
      type: String,
      value: "general"
    },
    maxSizeMB: {
      type: Number,
      value: 20
    },
    allowedExts: {
      type: Array,
      value: []
    }
  },
  data: {
    files: []
  },
  lifetimes: {
    attached() {
      this.setData({ files: normalizeIncomingFiles(this.data.value) });
    }
  },
  observers: {
    value(list) {
      const incoming = normalizeIncomingFiles(list);
      const pending = (this.data.files || []).filter((item) => item.status !== "uploaded");
      if (!pending.length) {
        this.setData({ files: incoming });
        return;
      }

      const dedupe = new Set(incoming.map((item) => item.path).filter(Boolean));
      const merged = [
        ...incoming,
        ...pending.filter((item) => !item.path || !dedupe.has(item.path))
      ];
      this.setData({ files: merged });
    }
  },
  methods: {
    getMaxSizeBytes() {
      const value = Number(this.data.maxSizeMB || 0);
      return value > 0 ? value * 1024 * 1024 : 0;
    },

    getAllowedExtSet() {
      return new Set((this.data.allowedExts || []).map(normalizeExt).filter(Boolean));
    },

    getExportFiles(files = this.data.files || []) {
      return files
        .filter((item) => item.status === "uploaded" && item.path)
        .map((item) => ({
          id: item.id,
          name: item.name,
          path: item.path,
          size: item.size,
          key: item.key,
          mimeType: item.mimeType
        }));
    },

    emitChange() {
      this.triggerEvent("change", { files: this.getExportFiles() });
    },

    isDevtools() {
      try {
        const info = wx.getSystemInfoSync();
        return info.platform === "devtools";
      } catch (_error) {
        return false;
      }
    },

    ensureScopeAuthorized(scope, title, content) {
      if (this.isDevtools()) {
        return Promise.resolve(true);
      }

      return new Promise((resolve) => {
        wx.getSetting({
          success: (settingRes) => {
            const authSetting = (settingRes && settingRes.authSetting) || {};
            const state = authSetting[scope];
            if (state === true) {
              resolve(true);
              return;
            }

            const askOpenSetting = () => {
              wx.showModal({
                title,
                content,
                confirmText: "去设置",
                cancelText: "取消",
                success: (modalRes) => {
                  if (!modalRes.confirm) {
                    resolve(false);
                    return;
                  }
                  wx.openSetting({
                    success: (openRes) => {
                      const nextAuth = (openRes && openRes.authSetting) || {};
                      resolve(Boolean(nextAuth[scope]));
                    },
                    fail: () => resolve(false)
                  });
                },
                fail: () => resolve(false)
              });
            };

            if (state === false) {
              askOpenSetting();
              return;
            }

            wx.authorize({
              scope,
              success: () => resolve(true),
              fail: () => askOpenSetting()
            });
          },
          fail: () => resolve(false)
        });
      });
    },

    normalizeChooseImageResult(tempFiles = []) {
      return tempFiles
        .map((item, index) => {
          const path = item.path || item.tempFilePath || "";
          return {
            id: buildUid(index),
            name: item.name || pickFileName(path, `图片_${index + 1}`),
            localPath: path,
            size: Number(item.size || 0),
            mimeType: String(item.type || "").startsWith("image") ? item.type : "image/*",
            status: "uploading",
            statusText: toStatusText("uploading"),
            progress: 0,
            error: "",
            isImage: true,
            path: "",
            key: "",
            uploadedByComponent: false,
            sizeText: formatFileSize(Number(item.size || 0))
          };
        })
        .filter((item) => item.localPath);
    },

    chooseImageWithSource(count, sourceType) {
      return new Promise((resolve, reject) => {
        if (typeof wx.chooseMedia === "function") {
          wx.chooseMedia({
            count,
            mediaType: ["image"],
            sourceType,
            sizeType: ["compressed"],
            camera: "back",
            success: (res) => {
              const selected = this.normalizeChooseImageResult(res.tempFiles || []);
              resolve(selected);
            },
            fail: (error) => reject(error)
          });
          return;
        }

        wx.chooseImage({
          count,
          sourceType,
          sizeType: ["compressed"],
          success: (res) => {
            const tempFiles = Array.isArray(res.tempFiles) && res.tempFiles.length
              ? res.tempFiles
              : (res.tempFilePaths || []).map((path) => ({ path, size: 0 }));
            resolve(this.normalizeChooseImageResult(tempFiles));
          },
          fail: (error) => reject(error)
        });
      });
    },

    chooseFileFromMessage(count) {
      return new Promise((resolve, reject) => {
        wx.chooseMessageFile({
          count,
          type: "file",
          success: (res) => {
            const selected = (res.tempFiles || [])
              .map((item, index) => ({
                id: buildUid(index),
                name: item.name || pickFileName(item.path, `附件_${index + 1}`),
                localPath: item.path,
                size: Number(item.size || 0),
                mimeType: "",
                status: "uploading",
                statusText: toStatusText("uploading"),
                progress: 0,
                error: "",
                isImage: looksLikeImage(item.name || item.path || "", ""),
                path: "",
                key: "",
                uploadedByComponent: false,
                sizeText: formatFileSize(Number(item.size || 0))
              }))
              .filter((item) => item.localPath);
            resolve(selected);
          },
          fail: (error) => reject(error)
        });
      });
    },

    async chooseFiles(count) {
      const isImageMode = this.data.accept === "image";
      if (this.isDevtools()) {
        return isImageMode ? this.chooseImageWithSource(count, ["album"]) : this.chooseFileFromMessage(count);
      }

      return new Promise((resolve, reject) => {
        const itemList = isImageMode
          ? ["拍照", "从相册选择"]
          : ["拍照", "从相册选择", "选择文件"];

        wx.showActionSheet({
          itemList,
          success: async (res) => {
            const tapIndex = Number(res.tapIndex);
            const chooseFromCamera = tapIndex === 0;
            const chooseFromAlbum = tapIndex === 1;
            const chooseFile = !isImageMode && tapIndex === 2;

            if (chooseFile) {
              this.chooseFileFromMessage(count).then(resolve).catch(reject);
              return;
            }

            if (chooseFromCamera) {
              const granted = await this.ensureScopeAuthorized(
                "scope.camera",
                "需要相机权限",
                "拍照上传附件需要相机权限，请在设置中开启后重试。"
              );
              if (!granted) {
                wx.showToast({ title: "未开启相机权限", icon: "none" });
                resolve([]);
                return;
              }
            }

            if (chooseFromCamera || chooseFromAlbum) {
              this.chooseImageWithSource(count, [chooseFromCamera ? "camera" : "album"])
                .then(resolve)
                .catch(reject);
              return;
            }

            resolve([]);
          },
          fail: (error) => reject(error)
        });
      });
    },

    validateSelectedFile(item) {
      const maxBytes = this.getMaxSizeBytes();
      if (maxBytes > 0 && Number(item.size || 0) > maxBytes) {
        return `文件过大，最大支持 ${this.data.maxSizeMB}MB`;
      }

      const allowExt = this.getAllowedExtSet();
      if (allowExt.size > 0) {
        const ext = getFileExt(item.name || item.localPath || "");
        if (!allowExt.has(ext)) {
          return `文件格式不支持，仅支持：${[...allowExt].join(", ")}`;
        }
      }
      return "";
    },

    async tryCompressForUpload(fileItem) {
      if (!fileItem || !fileItem.isImage || typeof wx.compressImage !== "function") {
        return fileItem;
      }

      const maxBytes = this.getMaxSizeBytes();
      if (!(maxBytes > 0) || Number(fileItem.size || 0) <= maxBytes) {
        return fileItem;
      }

      return new Promise((resolve) => {
        wx.compressImage({
          src: fileItem.localPath,
          quality: 60,
          success: async (res) => {
            const compressedPath = String((res && res.tempFilePath) || "").trim();
            if (!compressedPath) {
              resolve(fileItem);
              return;
            }
            const info = await fileInfo(compressedPath);
            resolve({
              ...fileItem,
              localPath: compressedPath,
              size: Number(info.size || 0),
              sizeText: formatFileSize(Number(info.size || 0))
            });
          },
          fail: () => resolve(fileItem)
        });
      });
    },

    updateFileById(id, updater) {
      const files = (this.data.files || []).map((item) => {
        if (item.id !== id) return item;
        const next = typeof updater === "function" ? updater(item) : { ...item, ...updater };
        return {
          ...item,
          ...next,
          statusText: toStatusText((next && next.status) || item.status),
          sizeText: formatFileSize(Number((next && next.size) != null ? next.size : item.size || 0))
        };
      });
      this.setData({ files });
      return files;
    },

    resolveUploadErrorMessage(error) {
      const statusCode = Number((error && error.statusCode) || 0);
      const rawMessage = String((error && (error.message || error.errMsg)) || "");
      const message = rawMessage.toLowerCase();

      if (statusCode === 404) return "上传接口不可用，请重启后端后重试";
      if (statusCode === 413 || message.includes("too large") || message.includes("limit_file_size")) {
        return "文件过大，请压缩后重试";
      }
      if (message.includes("domain list") || message.includes("url not in domain list")) {
        return "上传域名未配置，请检查开发者工具域名设置";
      }
      if (message.includes("refused") || message.includes("failed to connect") || message.includes("econnrefused")) {
        return "无法连接后端，请检查服务地址和端口";
      }
      if (message.includes("timeout")) {
        return "上传超时，请重试";
      }
      if (message.includes("cancel")) {
        return "已取消上传";
      }

      return rawMessage || "上传失败，请稍后重试";
    },

    async uploadFileItem(id) {
      const current = (this.data.files || []).find((item) => item.id === id);
      if (!current || !current.localPath) return;

      let candidate = await this.tryCompressForUpload(current);
      if (candidate.localPath !== current.localPath || Number(candidate.size || 0) !== Number(current.size || 0)) {
        this.updateFileById(id, {
          localPath: candidate.localPath,
          size: Number(candidate.size || 0)
        });
      }

      const validationMessage = this.validateSelectedFile(candidate);
      if (validationMessage) {
        this.updateFileById(id, {
          status: "failed",
          progress: 0,
          error: validationMessage
        });
        wx.showToast({ title: validationMessage, icon: "none" });
        return;
      }

      this.updateFileById(id, {
        status: "uploading",
        progress: 0,
        error: ""
      });

      try {
        const uploaded = await uploadAttachment({
          filePath: candidate.localPath,
          fileName: candidate.name,
          category: this.data.uploadCategory,
          onProgress: (progress) => {
            this.updateFileById(id, {
              status: "uploading",
              progress: Number(progress || 0)
            });
          }
        });

        this.updateFileById(id, {
          status: "uploaded",
          progress: 100,
          error: "",
          path: uploaded.url || "",
          key: uploaded.key || "",
          name: uploaded.name || candidate.name,
          size: Number(uploaded.size || candidate.size || 0),
          mimeType: uploaded.mimeType || candidate.mimeType || "",
          isImage: looksLikeImage(uploaded.name || candidate.name, uploaded.mimeType || ""),
          uploadedByComponent: true
        });
        this.emitChange();
      } catch (error) {
        const message = this.resolveUploadErrorMessage(error);
        this.updateFileById(id, {
          status: "failed",
          progress: 0,
          error: message
        });
        wx.showToast({ title: message, icon: "none" });
      }
    },

    async onChoose() {
      if (this.data.readonly) return;
      const rest = this.data.maxCount - (this.data.files || []).length;
      if (rest <= 0) {
        wx.showToast({ title: "已达到上传上限", icon: "none" });
        return;
      }

      try {
        const selected = await this.chooseFiles(rest);
        if (!selected || !selected.length) return;

        const files = [...(this.data.files || []), ...selected];
        this.setData({ files });
        for (let i = 0; i < selected.length; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await this.uploadFileItem(selected[i].id);
        }
      } catch (error) {
        if (!isCancelError(error)) {
          wx.showToast({ title: "选择文件失败", icon: "none" });
        }
      }
    },

    onPreview(event) {
      const index = Number((event.currentTarget.dataset || {}).index || -1);
      if (index < 0) return;
      const item = (this.data.files || [])[index];
      if (!item) return;

      if (item.status === "uploading") {
        wx.showToast({ title: "文件上传中，请稍候", icon: "none" });
        return;
      }

      const current = item.path || item.localPath;
      if (!current) return;

      if (item.isImage) {
        const imageUrls = (this.data.files || [])
          .map((file) => file.path || file.localPath)
          .filter((url, i) => {
            const source = (this.data.files || [])[i];
            return source && source.isImage && url;
          });
        wx.previewImage({
          urls: imageUrls.length ? imageUrls : [current],
          current
        });
        return;
      }

      const openLocal = (filePath) => {
        wx.openDocument({
          filePath,
          showMenu: true,
          fail: () => wx.showToast({ title: "该文件无法预览", icon: "none" })
        });
      };

      if (isRemotePath(current)) {
        wx.downloadFile({
          url: current,
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
              openLocal(res.tempFilePath);
              return;
            }
            wx.showToast({ title: "文件下载失败", icon: "none" });
          },
          fail: () => wx.showToast({ title: "文件下载失败", icon: "none" })
        });
        return;
      }

      openLocal(current);
    },

    onRetry(event) {
      if (this.data.readonly) return;
      const index = Number((event.currentTarget.dataset || {}).index || -1);
      if (index < 0) return;
      const item = (this.data.files || [])[index];
      if (!item || item.status !== "failed") return;
      this.uploadFileItem(item.id);
    },

    onRemove(event) {
      if (this.data.readonly) return;
      const index = Number((event.currentTarget.dataset || {}).index || -1);
      if (index < 0) return;
      const list = this.data.files || [];
      const target = list[index];
      if (!target) return;

      const files = list.slice();
      files.splice(index, 1);
      this.setData({ files });
      this.emitChange();

      if (target.uploadedByComponent && target.key) {
        deleteUploadedAttachment(target.key).catch(() => {
          // 删除远端文件失败不阻塞业务保存，仅做静默容错。
        });
      }
    }
  }
});
