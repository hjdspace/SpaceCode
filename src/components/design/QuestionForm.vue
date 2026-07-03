<template>
  <form @submit.prevent="handleSubmit" class="q-form">
    <div 
      v-for="q in form.questions" 
      :key="q.id" 
      class="form-item"
    >
      <label :for="q.id" class="form-label">
        {{ q.label }}
        <span v-if="q.required" class="required-star">*</span>
      </label>

      <!-- 1. text 类型 -->
      <input
        v-if="q.type === 'text'"
        :id="q.id"
        v-model="answers[q.id]"
        type="text"
        :placeholder="q.placeholder"
        :required="q.required"
        class="form-input"
      />

      <!-- 2. textarea 类型 -->
      <textarea
        v-else-if="q.type === 'textarea'"
        :id="q.id"
        v-model="answers[q.id]"
        :placeholder="q.placeholder"
        :required="q.required"
        class="form-textarea"
      ></textarea>

      <!-- 3. radio 类型 -->
      <div v-else-if="q.type === 'radio'" class="radio-group">
        <label 
          v-for="opt in formatOptions(q.options)" 
          :key="opt.value" 
          class="radio-label"
        >
          <input
            type="radio"
            v-model="answers[q.id]"
            :value="opt.value"
            :name="q.id"
            :required="q.required"
          />
          <span>{{ opt.label }}</span>
        </label>
      </div>

      <!-- 4. checkbox 类型 -->
      <div v-else-if="q.type === 'checkbox'" class="checkbox-group">
        <label 
          v-for="opt in formatOptions(q.options)" 
          :key="opt.value" 
          class="checkbox-label"
        >
          <input
            type="checkbox"
            v-model="answers[q.id]"
            :value="opt.value"
          />
          <span>{{ opt.label }}</span>
        </label>
      </div>

      <!-- 5. select 类型 -->
      <select
        v-else-if="q.type === 'select'"
        :id="q.id"
        v-model="answers[q.id]"
        :required="q.required"
        class="form-select"
      >
        <option value="" disabled>{{ q.placeholder || '请选择' }}</option>
        <option 
          v-for="opt in formatOptions(q.options)" 
          :key="opt.value" 
          :value="opt.value"
        >
          {{ opt.label }}
        </option>
      </select>

      <!-- 6. range 类型 -->
      <div v-else-if="q.type === 'range'" class="range-container">
        <input
          type="range"
          v-model.number="answers[q.id]"
          :min="q.min ?? 0"
          :max="q.max ?? 100"
          class="form-range"
        />
        <span class="range-val">{{ answers[q.id] }}</span>
      </div>

      <!-- 7. color 类型 -->
      <input
        v-else-if="q.type === 'color'"
        :id="q.id"
        v-model="answers[q.id]"
        type="color"
        class="form-color"
      />

      <!-- 8. switch / boolean 类型 -->
      <label v-else-if="q.type === 'switch'" class="switch-container">
        <input
          type="checkbox"
          v-model="answers[q.id]"
          class="switch-input"
        />
        <span class="switch-slider"></span>
      </label>

      <!-- 9. direction-cards 特殊类型：五大视觉风格卡片 -->
      <div v-else-if="q.type === 'direction-cards'" class="direction-grid">
        <div 
          v-for="opt in formatOptions(q.options)" 
          :key="opt.value"
          class="dir-card"
          :class="{ active: answers[q.id] === opt.value }"
          @click="answers[q.id] = opt.value"
        >
          <div class="dir-header">
            <span class="dir-title">{{ opt.label }}</span>
            <div class="dot" :class="{ active: answers[q.id] === opt.value }"></div>
          </div>
          <p class="dir-sub-desc">点击并选中该设计基调方案</p>
        </div>
      </div>
    </div>

    <button type="submit" class="submit-btn">
      <Check :size="14" />
      <span>提交品牌发现契约</span>
    </button>
  </form>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { QuestionFormBlock } from '@/utils/design/questionForm';
import { Check } from 'lucide-vue-next';

const props = defineProps<{
  form: QuestionFormBlock;
}>();

const emit = defineEmits<{
  (e: 'submit', answers: Record<string, any>): void;
}>();

const answers = ref<Record<string, any>>({});

// 监控表单改变，初始化默认值
watch(() => props.form, (newForm) => {
  const newAnswers: Record<string, any> = {};
  newForm.questions.forEach((q) => {
    if (q.defaultValue !== undefined) {
      newAnswers[q.id] = q.defaultValue;
    } else if (q.type === 'checkbox') {
      newAnswers[q.id] = [];
    } else if (q.type === 'switch') {
      newAnswers[q.id] = false;
    } else if (q.type === 'color') {
      newAnswers[q.id] = '#3b82f6';
    } else if (q.type === 'direction-cards' && q.options?.length) {
      const firstOpt = q.options[0];
      newAnswers[q.id] = typeof firstOpt === 'string' ? firstOpt : firstOpt.value;
    } else {
      newAnswers[q.id] = '';
    }
  });
  answers.value = newAnswers;
}, { immediate: true });

function formatOptions(options: any) {
  if (!options) return [];
  return options.map((opt: any) => {
    if (typeof opt === 'string') {
      return { value: opt, label: opt };
    }
    return opt;
  });
}

function handleSubmit() {
  emit('submit', answers.value);
}
</script>

<style scoped lang="scss">
.q-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 2px;
}

.required-star {
  color: #ef4444;
}

.form-input, .form-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;

  &:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
}

.form-textarea {
  width: 100%;
  height: 80px;
  padding: 8px 10px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background-color: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  resize: none;

  &:focus {
    border-color: var(--accent-primary);
    outline: none;
  }
}

.radio-group, .checkbox-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.radio-label, .checkbox-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}

.range-container {
  display: flex;
  align-items: center;
  gap: 10px;

  .form-range {
    flex: 1;
    cursor: pointer;
  }

  .range-val {
    font-size: 12px;
    font-weight: 600;
    min-width: 24px;
    text-align: right;
  }
}

.form-color {
  width: 50px;
  height: 32px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 0;
  background: none;
}

/* Switch 样式 */
.switch-container {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 22px;
  cursor: pointer;

  .switch-input {
    opacity: 0;
    width: 0;
    height: 0;

    &:checked + .switch-slider {
      background-color: var(--accent-primary);
    }

    &:checked + .switch-slider:before {
      transform: translateX(20px);
    }
  }

  .switch-slider {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: var(--surface-border);
    transition: .3s;
    border-radius: 22px;

    &:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
    }
  }
}

/* 发现协议中的 视觉方向卡片组 */
.direction-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.dir-card {
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 10px;
  background-color: var(--bg-primary);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: var(--accent-primary-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background-color: var(--accent-primary-glow);
  }

  .dir-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    
    .dir-title {
      font-size: 13px;
      font-weight: 600;
    }

    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      border: 1px solid var(--surface-border);

      &.active {
        background-color: var(--accent-primary);
        border-color: var(--accent-primary);
      }
    }
  }

  .dir-sub-desc {
    font-size: 10px;
    color: var(--text-muted);
    margin-top: 4px;
  }
}

.submit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  margin-top: 8px;
  background-color: var(--accent-primary);
  color: #ffffff;
  border: none;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background-color: var(--accent-primary-hover);
  }
}
</style>
