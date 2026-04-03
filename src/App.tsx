import React, { useEffect, useState, useRef } from 'react';
import { CATEGORY_COLORS } from './constants';
import Legend from './components/Legend';
import FloorPicker from './components/FloorPicker';

interface Level {
  id: string;
  name: string;
  short_name: string;
  ordinal: number;
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
}

declare global {
  interface Window {
    initMap: () => void;
    google: any;
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'Welcome to Wayfinder! I am your AI Concierge. How can I help you navigate today?', sender: 'ai' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [levels, setLevels] = useState<Level[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const mapRef = useRef<any>(null);
  const entranceMarkerRef = useRef<any>(null);
  const entranceInfoWindowRef = useRef<any>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch Levels
  useEffect(() => {
    const fetchLevels = async () => {
      try {
        const response = await fetch('/api/levels');
        if (response.ok) {
          const data = await response.json();
          setLevels(data);
          // Default to the ground floor (ordinal 0) or the first level
          if (data.length > 0 && !selectedLevelId) {
            const groundFloor = data.find((l: any) => l.ordinal === 0) || data[0];
            setSelectedLevelId(groundFloor.id);
          }
        }
      } catch (err) {
        console.error("Error fetching levels:", err);
      }
    };
    fetchLevels();
  }, []);

  // Update Map Style and Marker visibility when selectedLevelId changes
  useEffect(() => {
    if (mapRef.current) {
      if (mapRef.current.data) {
        applyMapStyle(mapRef.current);
      }
      
      // Handle "You are here" marker visibility
      // Parkway level ID: e537d463-475b-43c3-a650-184566c68bc9
      if (entranceMarkerRef.current) {
        if (selectedLevelId === 'e537d463-475b-43c3-a650-184566c68bc9') {
          entranceMarkerRef.current.setMap(mapRef.current);
          // Optionally open info window by default on the correct floor
          if (entranceInfoWindowRef.current) {
            entranceInfoWindowRef.current.open(mapRef.current, entranceMarkerRef.current);
          }
        } else {
          entranceMarkerRef.current.setMap(null);
          if (entranceInfoWindowRef.current) {
            entranceInfoWindowRef.current.close();
          }
        }
      }
    }
  }, [selectedLevelId, levels]);

  const applyMapStyle = (map: any) => {
    const selectedLevel = levels.find(l => l.id === selectedLevelId);
    const selectedOrdinal = selectedLevel?.ordinal;

    map.data.setStyle((feature: any) => {
      const category = feature.getProperty('category');
      const nodeType = feature.getProperty('node_type');
      const sourceFile = feature.getProperty('source_file');
      const levelId = feature.getProperty('level_id');
      const featureId = feature.getId();
      const isLevelFeature = sourceFile === 'level.geojson';
      
      let color = '#007aff'; // Default blue
      let weight = 1;
      let opacity = 0.2;
      let visible = true;

      // Hide anchor nodes as they cause confusion across levels
      if (nodeType === 'anchor') {
        visible = false;
      }

      // Filter by floor (ordinal)
      if (selectedOrdinal !== undefined) {
        if (levelId) {
          const featureLevel = levels.find(l => l.id === levelId);
          if (featureLevel && featureLevel.ordinal !== selectedOrdinal) {
            visible = false;
          }
        } else if (isLevelFeature) {
          const featureLevel = levels.find(l => l.id === featureId);
          if (featureLevel && featureLevel.ordinal !== selectedOrdinal) {
            visible = false;
          }
        }
      }

      // Styling based on category/type
      if (category && CATEGORY_COLORS[category]) {
        color = CATEGORY_COLORS[category].color;
        opacity = 0.4;
        
        // Custom opacities for specific categories
        if (category === 'walkway') opacity = 0.6;
        if (category === 'opentobelow') opacity = 0.1;
        if (category === 'nonpublic') opacity = 0.2;
        if (category === 'opening') opacity = 1;
      }
      
      // Styling based on source file
      if (sourceFile === 'venue.geojson') {
        color = '#000000';
        weight = 2;
        opacity = 0.05;
      } else if (sourceFile === 'footprint.geojson') {
        color = '#333333';
        weight = 1;
        opacity = 0.1;
      } else if (sourceFile === 'opening.geojson') {
        color = '#ff3b30';
        weight = 3;
        opacity = 1;
      } else if (sourceFile === 'level.geojson') {
        color = '#f8f9fa';
        weight = 1;
        opacity = 0.3;
      }

      return {
        fillColor: color,
        strokeColor: color,
        strokeWeight: weight,
        fillOpacity: opacity,
        visible: visible,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: color,
          fillOpacity: 0.8,
          strokeWeight: 1
        }
      };
    });
  };

  // Initialize Map
  useEffect(() => {
    window.initMap = async () => {
      // Coordinates for unit b2ff5e53-3ab3-4361-a045-09a5bc45ac53
      const startPos = { lat: 37.329478, lng: -121.889076 };
      const mapOptions = {
        zoom: 19,
        center: startPos,
        mapId: 'DEMO_MAP_ID',
        disableDefaultUI: false,
        styles: [
          {
            featureType: "poi",
            elementType: "labels",
            stylers: [{ visibility: "off" }]
          }
        ]
      };
      
      if (window.google) {
        const map = new window.google.maps.Map(document.getElementById('map'), mapOptions);
        mapRef.current = map;
        
        // Add a "You are here" marker for the starting point
        const entranceMarker = new window.google.maps.Marker({
          position: startPos,
          map: null, // Initially null, visibility handled by useEffect
          title: "You are here",
          icon: {
            // Material Design 'person_pin' icon path
            path: 'M12 2c-4.07 0-7.07 3.22-7.07 6.48 0 3.19 3.35 7.14 7.07 11.52 3.72-4.38 7.07-8.33 7.07-11.52C19.07 5.22 16.07 2 12 2zm0 4c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 10c-2.33 0-4.31-1.17-5.41-2.92.03-1.79 3.61-2.78 5.41-2.78 1.79 0 5.38.99 5.41 2.78-1.1 1.75-3.08 2.92-5.41 2.92z',
            fillColor: "#007aff",
            fillOpacity: 1,
            strokeWeight: 2,
            strokeColor: "#ffffff",
            scale: 2,
            anchor: new window.google.maps.Point(12, 20),
          }
        });
        entranceMarkerRef.current = entranceMarker;

        const entranceInfoWindow = new window.google.maps.InfoWindow({
          content: '<div style="padding: 4px; font-weight: 600; color: #1c1c1e;">You are here</div>'
        });
        entranceInfoWindowRef.current = entranceInfoWindow;
        
        entranceMarker.addListener('click', () => {
          entranceInfoWindow.open(map, entranceMarker);
        });

        // --- Fetch and Load Spanner Data ---
        try {
          const response = await fetch('/api/map-nodes');
          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch map nodes');
          }
          const data = await response.json();
          
          // Add GeoJSON data to map
          map.data.addGeoJson(data);

          // Fit map to bounds of the features
          const bounds = new window.google.maps.LatLngBounds();
          map.data.forEach((feature: any) => {
            const geometry = feature.getGeometry();
            if (geometry.getType() === 'Point') {
              bounds.extend(geometry.get());
            } else {
              geometry.forEachLatLng((latLng: any) => {
                bounds.extend(latLng);
              });
            }
          });
          if (!bounds.isEmpty()) {
            map.fitBounds(bounds);
          }

          // If mock data is used, notify the user
          if (data.source === 'mock') {
            setMessages(prev => {
              // Check if the warning already exists to avoid duplicates
              if (prev.some(m => m.id === 'mock-warning-static')) return prev;
              
              let warningText = '💡 Note: Using mock map data for this preview because the live Spanner API is restricted in this environment.';
              if (data.isApiDisabled && data.enableApiUrl) {
                warningText = `⚠️ Spanner API is disabled. Please enable it here: ${data.enableApiUrl}`;
              }

              return [...prev, {
                id: 'mock-warning-static',
                text: warningText,
                sender: 'ai'
              }];
            });
          }
          
          // Style the GeoJSON features
          applyMapStyle(map);

          // Show info window on click
          const infoWindow = new window.google.maps.InfoWindow();
          map.data.addListener('click', (event: any) => {
            const feature = event.feature;
            
            // Helper to capitalize strings for better display
            const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\./g, ' ');

            // Correct way to get properties from Google Maps Data Layer features
            const nameProp = feature.getProperty('name');
            const categoryProp = feature.getProperty('category');
            const nodeType = feature.getProperty('node_type') || 'No Type';
            const sourceFile = feature.getProperty('source_file') || 'Unknown';

            // Handle object-based category
            const category = (typeof categoryProp === 'object' && categoryProp !== null)
              ? (categoryProp.en || Object.values(categoryProp)[0] || 'No Category')
              : (categoryProp || 'No Category');

            // Improved name logic with fallbacks
            let name = 'Unnamed Space';
            const altNameProp = feature.getProperty('alt_name');
            
            if (typeof nameProp === 'object' && nameProp !== null && Object.keys(nameProp).length > 0) {
              name = nameProp.en || Object.values(nameProp)[0] || name;
            } else if (nameProp && typeof nameProp === 'string' && nameProp.trim() !== '') {
              name = nameProp;
            } else if (typeof altNameProp === 'object' && altNameProp !== null && Object.keys(altNameProp).length > 0) {
              name = altNameProp.en || Object.values(altNameProp)[0] || name;
            } else if (altNameProp && typeof altNameProp === 'string' && altNameProp.trim() !== '') {
              name = altNameProp;
            }

            // If name is still generic, use category or nodeType as fallback
            if (name === 'Unnamed Space') {
              if (category && category !== 'No Category') {
                name = capitalize(category);
              } else if (nodeType && nodeType !== 'No Type') {
                name = capitalize(nodeType);
              } else if (feature.getId()) {
                name = `Space ${feature.getId().toString().slice(0, 8)}`;
              }
            }
            
            infoWindow.setContent(`
              <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 250px;">
                <h3 style="margin: 0 0 4px 0; font-size: 16px; color: #1c1c1e; font-weight: 600;">${name}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
                  <span style="background: #e5e5ea; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #3a3a3c; font-weight: 500;">${category}</span>
                  <span style="background: #f2f2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #8e8e93;">${nodeType}</span>
                </div>
                <div style="font-size: 13px; color: #3a3a3c; margin-bottom: 4px;">
                  <strong>Source:</strong> ${sourceFile}
                </div>
                <div style="font-size: 12px; color: #8e8e93; margin-top: 8px; border-top: 1px solid #e5e5ea; padding-top: 8px;">
                  ID: ${feature.getId() || 'N/A'}
                </div>
              </div>
            `);
            infoWindow.setPosition(event.latLng);
            infoWindow.open(map);
          });

        } catch (error: any) {
          console.error("Error loading map nodes:", error);
          // Update the UI to show the specific error if the API is disabled
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            text: `⚠️ Error loading map data: ${error.message}. Please ensure the Spanner API is enabled in your Google Cloud project.`,
            sender: 'ai'
          }]);
        }
      }
    };

    // If script already loaded, call initMap
    if (window.google && window.google.maps) {
      window.initMap();
    }
  }, []);

  const handleChatSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputValue,
      sender: 'user'
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');

    // Simulate AI Response
    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "I'm calculating the best route to the T-Rex exhibit for you. Please follow the red line on the map.",
        sender: 'ai'
      };
      setMessages(prev => [...prev, aiMessage]);
      
      // Draw a sample route line
      drawRouteLine([
        { lat: 37.329, lng: -121.888 },
        { lat: 37.3295, lng: -121.8885 },
        { lat: 37.330, lng: -121.888 }
      ]);
    }, 1000);
  };

  const drawRouteLine = (coordinates: { lat: number; lng: number }[]) => {
    if (!window.google || !mapRef.current) return;

    const routePath = new window.google.maps.Polyline({
      path: coordinates,
      geodesic: true,
      strokeColor: '#FF0000',
      strokeOpacity: 1.0,
      strokeWeight: 4,
    });

    routePath.setMap(mapRef.current);
    
    // Auto-center on the route
    const bounds = new window.google.maps.LatLngBounds();
    coordinates.forEach(coord => bounds.extend(coord));
    mapRef.current.fitBounds(bounds);
  };

  return (
    <div className="app-container">
      {/* Left Panel: Chat UI */}
      <div className="chat-panel">
        <header className="chat-header">
          <h1>Wayfinder</h1>
        </header>
        
        <div className="message-history">
          {messages.map((msg) => (
            <div key={msg.id} className={`message ${msg.sender}`}>
              {msg.text}
            </div>
          ))}
          <div ref={messageEndRef} />
        </div>

        <form className="chat-input-area" onSubmit={handleChatSubmit}>
          <input 
            type="text" 
            placeholder="Ask for directions..." 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button type="submit">Send</button>
        </form>
      </div>

      {/* Right Panel: Map UI */}
      <div className="map-panel">
        <Legend />
        <FloorPicker 
          levels={levels} 
          selectedLevelId={selectedLevelId} 
          onSelectLevel={setSelectedLevelId} 
        />
        <div id="map"></div>
      </div>
    </div>
  );
}
