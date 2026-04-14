import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Calendar, HardDrive, Layers, SlidersHorizontal,
  ChevronDown, X
} from 'lucide-react';

// 时间筛选选项
const TIME_FILTERS = [
  { id: 'any', label: '不限时间', value: null },
  { id: '24h', label: '24小时内', value: 1 },
  { id: '7d', label: '7天内', value: 7 },
  { id: '30d', label: '30天内', value: 30 },
  { id: '90d', label: '3个月内', value: 90 },
  { id: '1y', label: '1年内', value: 365 },
];

// 大小筛选选项
const SIZE_FILTERS = [
  { id: 'any', label: '不限大小', min: null, max: null },
  { id: 'tiny', label: '< 100 MB', min: 0, max: 100 * 1024 * 1024 },
  { id: 'small', label: '100 MB - 1 GB', min: 100 * 1024 * 1024, max: 1024 ** 3 },
  { id: 'medium', label: '1 - 4 GB', min: 1024 ** 3, max: 4 * 1024 ** 3 },
  { id: 'large', label: '4 - 20 GB', min: 4 * 1024 ** 3, max: 20 * 1024 ** 3 },
  { id: 'huge', label: '> 20 GB', min: 20 * 1024 ** 3, max: null },
];

// 文件数筛选
const FILE_COUNT_FILTERS = [
  { id: 'any', label: '不限数量', min: null, max: null },
  { id: 'single', label: '单文件', min: 1, max: 1 },
  { id: 'few', label: '2-10个', min: 2, max: 10 },
  { id: 'many', label: '11-50个', min: 11, max: 50 },
  { id: 'lots', label: '50+个', min: 50, max: null },
];

const SmartFilterBar = ({ filters, onChange, resultCount }) => {
  const [expanded, setExpanded] = useState(false);

  const activeFiltersCount = [
    filters.time !== 'any',
    filters.size !== 'any',
    filters.files !== 'any',
  ].filter(Boolean).length;

  const clearAll = () => {
    onChange({ time: 'any', size: 'any', files: 'any' });
  };

  return (
    <div className="space-y-2">
      {/* 主筛选栏 */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className={`
            flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all
            ${activeFiltersCount > 0 
              ? 'bg-aurora-cyan/20 text-aurora-cyan border border-aurora-cyan/30' 
              : 'bg-dark-850 text-dark-300 hover:bg-dark-800 border border-dark-700'}
          `}
        >
          <SlidersHorizontal className="w-4 h-4" />
          筛选
          {activeFiltersCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-aurora-cyan text-dark-950 text-xs rounded-md">
              {activeFiltersCount}
            </span>
          )}
          <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>

        {/* 快捷标签 */}
        {filters.time !== 'any' && (
          <FilterTag 
            icon={Calendar}
            label={TIME_FILTERS.find(t => t.id === filters.time)?.label}
            onRemove={() => onChange({ ...filters, time: 'any' })}
          />
        )}
        {filters.size !== 'any' && (
          <FilterTag 
            icon={HardDrive}
            label={SIZE_FILTERS.find(s => s.id === filters.size)?.label}
            onRemove={() => onChange({ ...filters, size: 'any' })}
          />
        )}
        {filters.files !== 'any' && (
          <FilterTag 
            icon={Layers}
            label={FILE_COUNT_FILTERS.find(f => f.id === filters.files)?.label}
            onRemove={() => onChange({ ...filters, files: 'any' })}
          />
        )}

        {activeFiltersCount > 0 && (
          <button
            onClick={clearAll}
            className="text-xs text-dark-500 hover:text-dark-300 px-2"
          >
            清除全部
          </button>
        )}

        <span className="ml-auto text-sm text-dark-500">
          {resultCount.toLocaleString()} 个结果
        </span>
      </div>

      {/* 展开的面板 */}
      <motion.div
        initial={false}
        animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
        className="overflow-hidden"
      >
        <div className="p-4 bg-dark-850 rounded-2xl border border-dark-700 space-y-4">
          {/* 时间筛选 */}
          <FilterSection
            title="收录时间"
            icon={Calendar}
            options={TIME_FILTERS}
            value={filters.time}
            onChange={(v) => onChange({ ...filters, time: v })}
          />

          {/* 大小筛选 */}
          <FilterSection
            title="文件大小"
            icon={HardDrive}
            options={SIZE_FILTERS}
            value={filters.size}
            onChange={(v) => onChange({ ...filters, size: v })}
          />

          {/* 文件数筛选 */}
          <FilterSection
            title="文件数量"
            icon={Layers}
            options={FILE_COUNT_FILTERS}
            value={filters.files}
            onChange={(v) => onChange({ ...filters, files: v })}
          />
        </div>
      </motion.div>
    </div>
  );
};

const FilterTag = ({ icon: Icon, label, onRemove }) => (
  <span className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-850 text-dark-300 rounded-lg text-sm border border-dark-700">
    <Icon className="w-3.5 h-3.5 text-dark-500" />
    {label}
    <button onClick={onRemove} className="ml-1 hover:text-rose-400">
      <X className="w-3.5 h-3.5" />
    </button>
  </span>
);

const FilterSection = ({ title, icon: Icon, options, value, onChange }) => (
  <div>
    <div className="flex items-center gap-2 mb-3 text-sm text-dark-500">
      <Icon className="w-4 h-4" />
      {title}
    </div>
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={`
            px-3 py-1.5 rounded-lg text-sm transition-all
            ${value === opt.id
              ? 'bg-aurora-cyan/20 text-aurora-cyan border border-aurora-cyan/30'
              : 'bg-dark-900 text-dark-400 hover:text-dark-300 hover:bg-dark-800 border border-transparent'}
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  </div>
);

export default SmartFilterBar;
