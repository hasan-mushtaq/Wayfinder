import React from 'react';

interface Level {
  id: string;
  name: string;
  short_name: string;
  ordinal: number;
}

interface FloorPickerProps {
  levels: Level[];
  selectedLevelId: string | null;
  onSelectLevel: (levelId: string) => void;
}

const FloorPicker: React.FC<FloorPickerProps> = ({ levels, selectedLevelId, onSelectLevel }) => {
  if (levels.length === 0) return null;

  // Group levels by ordinal to show unique floors
  const uniqueFloors = levels.reduce((acc, level) => {
    if (!acc.find(l => l.ordinal === level.ordinal)) {
      acc.push(level);
    }
    return acc;
  }, [] as Level[]).sort((a, b) => a.ordinal - b.ordinal);

  return (
    <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-2 bg-white/90 backdrop-blur-md p-2 rounded-2xl shadow-xl border border-gray-200 z-[1000]">
      <div className="text-[10px] font-bold text-gray-400 text-center uppercase tracking-widest mb-1">Floor</div>
      <div className="flex flex-col gap-1.5">
        {uniqueFloors.slice().reverse().map((level) => (
          <button
            key={level.id}
            onClick={() => onSelectLevel(level.id)}
            className={`
              px-4 h-10 rounded-xl flex items-center justify-center text-xs font-bold transition-all whitespace-nowrap
              ${selectedLevelId === level.id || levels.find(l => l.id === selectedLevelId)?.ordinal === level.ordinal
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 scale-105' 
                : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}
            `}
          >
            {level.name}
          </button>
        ))}
      </div>
    </div>
  );
};

export default FloorPicker;
