function formatFileSize(size) {
  const value = Number(size || 0);
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeFiles(list) {
  return (list || []).map((item) => {
    const size = Number(item.size || 0);
    return {
      name: item.name || "附件",
      path: item.path || item.url || "",
      size,
      sizeText: formatFileSize(size)
    };
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
    }
  },
  data: {
    files: []
  },
  lifetimes: {
    attached() {
      this.setData({ files: normalizeFiles(this.data.value) });
    }
  },
  observers: {
    value(list) {
      this.setData({ files: normalizeFiles(list) });
    }
  },
  methods: {
    appendFiles(selected) {
      const files = [...this.data.files, ...normalizeFiles(selected)];
      this.setData({ files });
      this.triggerEvent("change", { files });
    },
    onChoose() {
      if (this.data.readonly) return;
      const rest = this.data.maxCount - this.data.files.length;
      if (rest <= 0) {
        wx.showToast({ title: "已达到上传上限", icon: "none" });
        return;
      }

      if (this.data.accept === "image") {
        wx.chooseImage({
          count: rest,
          sourceType: ["album", "camera"],
          sizeType: ["compressed"],
          success: (res) => {
            const tempFiles = Array.isArray(res.tempFiles) && res.tempFiles.length
              ? res.tempFiles
              : (res.tempFilePaths || []).map((path) => ({ path, size: 0 }));
            const selected = tempFiles
              .map((item, index) => {
                const path = item.path || item.tempFilePath || "";
                return {
                  name: item.name || `image_${Date.now()}_${index + 1}`,
                  path,
                  size: Number(item.size || 0)
                };
              })
              .filter((item) => item.path);
            this.appendFiles(selected);
          }
        });
        return;
      }

      wx.chooseMessageFile({
        count: rest,
        type: "file",
        success: (res) => {
          const selected = (res.tempFiles || []).map((item) => ({
            name: item.name,
            path: item.path,
            size: item.size
          }));
          this.appendFiles(selected);
        }
      });
    },
    onPreview(event) {
      const { path } = event.currentTarget.dataset;
      if (!path) return;
      const lower = String(path).toLowerCase();
      if (lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
        wx.previewImage({ urls: [path], current: path });
        return;
      }
      wx.openDocument({
        filePath: path,
        showMenu: true,
        fail: () => wx.showToast({ title: "该文件无法预览", icon: "none" })
      });
    },
    onRemove(event) {
      if (this.data.readonly) return;
      const index = Number(event.currentTarget.dataset.index);
      if (Number.isNaN(index)) return;
      const files = this.data.files.slice();
      files.splice(index, 1);
      this.setData({ files });
      this.triggerEvent("change", { files });
    }
  }
});
