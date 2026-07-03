import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { QuestionFormBlock } from '@/utils/design/questionForm';

export interface DesignSystem {
  id: string;
  name: string;
  category: string;
}

export interface DesignSkill {
  id: string;
  name: string;
  description: string;
  mode?: string;
}

export interface ArtifactFile {
  name: string;
  path: string;
  updatedAt: number;
}

export const useDesignStore = defineStore('design', () => {
  // 1. 用户输入与选中状态
  const brief = ref('');
  const selectedSystemId = ref<string>('');
  const selectedSkillId = ref<string>('huashu-design'); // 默认华术设计 (中文设计师章程)
  const selectedDirectionId = ref<string>(''); // 当未选择设计系统时启用的视觉流派
  
  // 2. 会话关联状态
  const activeSessionId = ref<string | null>(null);
  const designWorkspace = ref<string>(''); // 设计工作目录

  // 3. 实时预览与产物状态
  const previewHtml = ref<string>('');
  const previewTitle = ref<string>('Design Preview');
  const artifactFiles = ref<ArtifactFile[]>([]);
  const selectedArtifactPath = ref<string | null>(null);

  // 4. Question-Form 发现表单协议状态
  const pendingQuestionForm = ref<QuestionFormBlock | null>(null);

  // 5. 数据源列表 (由 Electron IPC 供给)
  const designSystems = ref<DesignSystem[]>([]);
  const designSkills = ref<DesignSkill[]>([
    { id: 'huashu-design', name: '华术设计 (Huashu Design)', description: '遵循大师级中文设计师章程，5维度精细打磨，杜绝 AI 垃圾套路' },
    { id: 'canvas-design', name: 'Canvas 互动设计 (Canvas Design)', description: '基于 Canvas API/WebGL 的高动效、高保真游戏化 UI 设计' },
    { id: 'ui-ux-pro-max', name: 'UI/UX Pro Max', description: '高品质多文件响应式 Web 原型系统设计，支持 Tailwind 自动构建' },
    { id: 'html-ppt-skill', name: '演示文稿专家 (Morph PPT)', description: 'HTML 动态转场幻灯片设计模式' }
  ]);

  // 计算属性：当前选中的设计系统
  const currentSystem = computed(() => 
    designSystems.value.find(s => s.id === selectedSystemId.value) || null
  );

  // 动作 actions
  function setBrief(val: string) {
    brief.value = val;
  }

  function setPendingQuestionForm(form: QuestionFormBlock | null) {
    pendingQuestionForm.value = form;
  }

  function clearPendingQuestionForm() {
    pendingQuestionForm.value = null;
  }

  function updateArtifactFiles(files: ArtifactFile[]) {
    artifactFiles.value = files;
  }

  return {
    brief,
    selectedSystemId,
    selectedSkillId,
    selectedDirectionId,
    activeSessionId,
    designWorkspace,
    previewHtml,
    previewTitle,
    artifactFiles,
    selectedArtifactPath,
    pendingQuestionForm,
    designSystems,
    designSkills,
    currentSystem,
    setBrief,
    setPendingQuestionForm,
    clearPendingQuestionForm,
    updateArtifactFiles,
  };
});
