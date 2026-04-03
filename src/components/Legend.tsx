import React from 'react';
import { CATEGORY_COLORS } from '../constants';

const Legend: React.FC = () => {
  // Group categories by color to avoid duplicate entries in the legend
  // We want to show: Rooms, Walkways, Stairs, Elevators, Escalators, Restrooms, Parking, Openings
  const displayItems = [
    { color: '#ff9500', label: 'Rooms' },
    { color: '#f2f2f7', label: 'Walkways' },
    { color: '#5856d6', label: 'Stairs' },
    { color: '#af52de', label: 'Elevators' },
    { color: '#ff2d55', label: 'Escalators' },
    { color: '#34c759', label: 'Restrooms' },
    { color: '#8e8e93', label: 'Parking' },
    { color: '#ff3b30', label: 'Openings' },
  ];

  return (
    <div className="absolute bottom-6 left-6 bg-white/90 backdrop-blur-md p-4 rounded-xl shadow-lg border border-gray-200 z-[1000] max-w-[200px] pointer-events-none">
      <h4 className="text-[10px] font-bold text-gray-400 mb-3 uppercase tracking-widest">Map Legend</h4>
      <div className="space-y-2.5">
        {displayItems.map((item) => (
          <div key={item.color} className="flex items-center gap-3">
            <div 
              className="w-3 h-3 rounded-full border border-black/5 shadow-sm" 
              style={{ backgroundColor: item.color }}
            />
            <span className="text-xs text-gray-700 font-semibold">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default Legend;
