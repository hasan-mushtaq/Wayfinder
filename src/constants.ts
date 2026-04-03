export const CATEGORY_COLORS: Record<string, { color: string; label: string }> = {
  room: { color: '#ff9500', label: 'Rooms' },
  walkway: { color: '#f2f2f7', label: 'Walkways' },
  stairs: { color: '#5856d6', label: 'Stairs' },
  steps: { color: '#5856d6', label: 'Steps' },
  elevator: { color: '#00c7be', label: 'Elevators' },
  escalator: { color: '#ffcc00', label: 'Escalators' },
  restroom: { color: '#34c759', label: 'Restrooms' },
  'restroom.male': { color: '#34c759', label: 'Restrooms' },
  'restroom.female': { color: '#34c759', label: 'Restrooms' },
  parking: { color: '#8e8e93', label: 'Parking' },
  nonpublic: { color: '#c7c7cc', label: 'Non-public' },
  opentobelow: { color: '#ffffff', label: 'Open to Below' },
  opening: { color: '#ff3b30', label: 'Openings' },
};

export const SOURCE_COLORS: Record<string, { color: string; label: string }> = {
  'venue.geojson': { color: '#000000', label: 'Venue Boundary' },
  'footprint.geojson': { color: '#333333', label: 'Building Footprint' },
  'opening.geojson': { color: '#ff3b30', label: 'Openings' },
};
