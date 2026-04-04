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
  details?: string;
}

declare global {
  interface Window {
    initMap: () => void;
    google: any;
    handleNavigate: (destinationId: string, destinationName: string) => void;
    handleSetStart: (nodeId: string, nodeName: string, lat: number, lng: number) => void;
    handleClearStart: () => void;
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', text: 'Welcome to Wayfinder! I am your AI Concierge. How can I help you navigate today?', sender: 'ai' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [levels, setLevels] = useState<Level[]>([]);
  const levelsRef = useRef<Level[]>([]);
  
  useEffect(() => {
    levelsRef.current = levels;
  }, [levels]);

  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [startNode, setStartNode] = useState<{ id: string, name: string } | null>(null);
  const startNodeRef = useRef<{ id: string, name: string } | null>(null);
  
  useEffect(() => {
    startNodeRef.current = startNode;
  }, [startNode]);

  const selectedLevelIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedLevelIdRef.current = selectedLevelId;
  }, [selectedLevelId]);
  const mapRef = useRef<any>(null);
  const startMarkerRef = useRef<any>(null);
  const currentRouteRef = useRef<any>(null);
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

  // Update Map Style when selectedLevelId changes
  useEffect(() => {
    if (mapRef.current) {
      if (mapRef.current.data) {
        applyMapStyle(mapRef.current);
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
            const rawLevelId = feature.getProperty('level_id') || (sourceFile === 'level.geojson' ? feature.getId() : null);
            const levelId = rawLevelId ? rawLevelId.toString() : null;

            // Find level name
            let level = levelsRef.current.find(l => l.id.toString() === levelId);
            
            // Fallback to currently selected level if lookup fails
            // (Since only features for the selected level are visible)
            if (!level && selectedLevelIdRef.current) {
              level = levelsRef.current.find(l => l.id.toString() === selectedLevelIdRef.current?.toString());
            }
            
            const levelName = level ? level.name : 'Unknown Level';

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
            
            const featureId = feature.getId()?.toString();
            const lat = event.latLng.lat();
            const lng = event.latLng.lng();
            const isStartNode = startNodeRef.current?.id === featureId;
            
            infoWindow.setContent(`
              <div style="padding: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 250px;">
                <h3 style="margin: 0 0 4px 0; font-size: 16px; color: #1c1c1e; font-weight: 600;">${name}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
                  <span style="background: #e5e5ea; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #3a3a3c; font-weight: 500;">${category}</span>
                  <span style="background: #f2f2f7; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #8e8e93;">${nodeType}</span>
                </div>
                <div style="font-size: 13px; color: #3a3a3c; margin-bottom: 4px;">
                  <strong>Level:</strong> ${levelName}
                </div>
                <div style="font-size: 12px; color: #8e8e93; margin-top: 8px; border-top: 1px solid #e5e5ea; padding-top: 8px; margin-bottom: 12px;">
                  ID: ${featureId || 'N/A'}
                </div>
                
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${!startNodeRef.current ? `
                    <button 
                      style="width: 100%; background: #007aff; color: white; border: none; padding: 8px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px;"
                      onclick="window.handleSetStart('${featureId}', '${name.replace(/'/g, "\\'")}', ${lat}, ${lng})"
                    >
                      Set as Start
                    </button>
                  ` : isStartNode ? `
                    <button 
                      style="width: 100%; background: #ff3b30; color: white; border: none; padding: 8px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px;"
                      onclick="window.handleClearStart()"
                    >
                      Clear Start
                    </button>
                  ` : `
                    <button 
                      style="width: 100%; background: #34c759; color: white; border: none; padding: 8px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px;"
                      onclick="window.handleNavigate('${featureId}', '${name.replace(/'/g, "\\'")}')"
                    >
                      Navigate here
                    </button>
                    <button 
                      style="width: 100%; background: #e5e5ea; color: #3a3a3c; border: none; padding: 8px; border-radius: 6px; font-weight: 600; cursor: pointer; font-size: 13px;"
                      onclick="window.handleSetStart('${featureId}', '${name.replace(/'/g, "\\'")}', ${lat}, ${lng})"
                    >
                      Change Start
                    </button>
                  `}
                </div>
              </div>
            `);
            infoWindow.setPosition(event.latLng);
            infoWindow.open(map);
          });

          // Handle setting the start node
          window.handleSetStart = (nodeId: string, nodeName: string, lat: number, lng: number) => {
            setStartNode({ id: nodeId, name: nodeName });
            
            // Clear existing route if any
            if (currentRouteRef.current) {
              currentRouteRef.current.setMap(null);
            }

            // Place marker
            if (startMarkerRef.current) {
              startMarkerRef.current.setMap(null);
            }

            startMarkerRef.current = new window.google.maps.Marker({
              position: { lat, lng },
              map: mapRef.current,
              title: `Start: ${nodeName}`,
              icon: {
                path: 'M12 2c-4.07 0-7.07 3.22-7.07 6.48 0 3.19 3.35 7.14 7.07 11.52 3.72-4.38 7.07-8.33 7.07-11.52C19.07 5.22 16.07 2 12 2zm0 4c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 10c-2.33 0-4.31-1.17-5.41-2.92.03-1.79 3.61-2.78 5.41-2.78 1.79 0 5.38.99 5.41 2.78-1.1 1.75-3.08 2.92-5.41 2.92z',
                fillColor: "#007aff",
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: "#ffffff",
                scale: 2,
                anchor: new window.google.maps.Point(12, 20),
              }
            });

            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              text: `Start point set to ${nodeName}. Now select your destination.`,
              sender: 'ai'
            }]);
            
            infoWindow.close();
          };

          // Handle clearing the start node
          window.handleClearStart = () => {
            setStartNode(null);
            if (startMarkerRef.current) {
              startMarkerRef.current.setMap(null);
            }
            if (currentRouteRef.current) {
              currentRouteRef.current.setMap(null);
            }
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              text: `Start point cleared.`,
              sender: 'ai'
            }]);
            infoWindow.close();
          };

          // Expose handleNavigate to window for the button click
          window.handleNavigate = async (destinationId: string, destinationName: string) => {
            const currentStart = startNodeRef.current;
            if (!currentStart) return;

            const startNodeId = currentStart.id;
            const gqlQuery = `GRAPH indoorRoutingGraph
MATCH p = ANY SHORTEST (start_node:Node {
  node_id: '${startNodeId}'
})-[e:connectsTo]->{1, 20} (end_node:Node {
  node_id: '${destinationId}'
})
RETURN
  SAFE_TO_JSON(NODES(p)) AS route_nodes,
  SAFE_TO_JSON(EDGES(p)) AS route_edges;`;
            
            setMessages(prev => [...prev, {
              id: Date.now().toString(),
              text: `Navigating from ${currentStart.name} to ${destinationName}...`,
              sender: 'user'
            }]);

            try {
              const response = await fetch('/api/route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ startNodeId, endNodeId: destinationId })
              });

              if (!response.ok) {
                const errorData = await response.json();
                const detailsText = `--- GQL QUERY ---\n${gqlQuery}\n\n--- ERROR RESPONSE ---\n${JSON.stringify(errorData, null, 2)}`;
                setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  text: `❌ Routing failed: ${errorData.error || 'Unknown error'}`,
                  sender: 'ai',
                  details: detailsText
                }]);
                return;
              }

              const data = await response.json();
              
              if (data.coordinates && data.coordinates.length > 0) {
                // Convert [lng, lat] to {lat, lng} for Google Maps
                const path = data.coordinates.map((coord: [number, number]) => ({
                  lat: coord[1],
                  lng: coord[0]
                }));
                
                drawRouteLine(path);

                // Generate descriptive instructions
                const steps: string[] = [];
                data.nodes.forEach((node: any, index: number) => {
                  const props = node.properties || {};
                  const name = props.name || (props.category ? props.category.replace(/\./g, ' ') : props.node_type);
                  const capitalized = name.charAt(0).toUpperCase() + name.slice(1);
                  const category = (props.category || '').toLowerCase();
                  const levelId = props.level_id || props.levelId || props.floor_number;

                  // Check for floor change from previous node
                  if (index > 0) {
                    const prevNode = data.nodes[index - 1];
                    const prevProps = prevNode.properties || {};
                    const prevLevelId = prevProps.level_id || prevProps.levelId || prevProps.floor_number;

                    if (prevLevelId && levelId && String(prevLevelId) !== String(levelId)) {
                      // Try to find levels by ID or ordinal/floor_number
                      const currentLevel = levelsRef.current.find(l => String(l.id) === String(levelId) || String(l.ordinal) === String(levelId));
                      const prevLevel = levelsRef.current.find(l => String(l.id) === String(prevLevelId) || String(l.ordinal) === String(prevLevelId));
                      
                      if (currentLevel && prevLevel) {
                        const direction = currentLevel.ordinal > prevLevel.ordinal ? 'up' : 'down';
                        let facility = 'stairs/elevator';
                        
                        // Check current or previous node for facility type
                        const combinedCategory = (category + ' ' + (prevProps.category || '').toLowerCase());
                        if (combinedCategory.includes('elevator')) facility = 'elevator';
                        else if (combinedCategory.includes('escalator')) facility = 'escalator';
                        else if (combinedCategory.includes('stairs') || combinedCategory.includes('steps')) facility = 'stairs';
                        
                        steps.push(`take the ${facility} ${direction} to ${currentLevel.name}`);
                      }
                    }
                  }

                  let stepText = '';
                  if (index === 0) stepText = `Start at ${capitalized}`;
                  else if (index === data.nodes.length - 1) stepText = `arrive at ${capitalized}`;
                  else {
                    const isFacility = category.includes('elevator') || category.includes('escalator') || category.includes('stairs') || category.includes('steps');
                    stepText = isFacility ? `pass through the ${name.toLowerCase()} area` : `pass through ${capitalized}`;
                  }

                  // Deduplicate consecutive identical steps
                  if (steps.length === 0 || steps[steps.length - 1] !== stepText) {
                    steps.push(stepText);
                  }
                });

                const instructionText = steps.length > 1 
                  ? `${steps.slice(0, -1).join(', ')}, and finally ${steps[steps.length - 1]}.`
                  : `You are already at your destination.`;
                
                const detailsText = `--- GQL QUERY ---\n${gqlQuery}\n\n--- GQL RESPONSE ---\n${JSON.stringify(data, null, 2)}`;

                setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  text: `Route found (${data.nodes.length} steps)! ${instructionText}`,
                  sender: 'ai',
                  details: detailsText
                }]);
                
                infoWindow.close();
              } else {
                const detailsText = `--- GQL QUERY ---\n${gqlQuery}\n\n--- GQL RESPONSE ---\n${JSON.stringify(data, null, 2)}`;
                setMessages(prev => [...prev, {
                  id: Date.now().toString(),
                  text: `❌ No route found between these points.`,
                  sender: 'ai',
                  details: detailsText
                }]);
              }
            } catch (err: any) {
              console.error("Routing error:", err);
              const detailsText = `--- GQL QUERY ---\n${gqlQuery}${err.details ? `\n\n--- ERROR ---\n${err.details}` : ''}`;
              
              setMessages(prev => [...prev, {
                id: Date.now().toString(),
                text: `❌ Could not find a route: ${err.message}`,
                sender: 'ai',
                details: detailsText
              }]);
            }
          };

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

    // Clear previous route
    if (currentRouteRef.current) {
      currentRouteRef.current.setMap(null);
    }

    const routePath = new window.google.maps.Polyline({
      path: coordinates,
      geodesic: true,
      strokeColor: '#007aff',
      strokeOpacity: 1.0,
      strokeWeight: 8,
      zIndex: 1000,
    });

    // Add a white "glow" or border for better visibility on dark/busy map areas
    const routeBorder = new window.google.maps.Polyline({
      path: coordinates,
      geodesic: true,
      strokeColor: '#ffffff',
      strokeOpacity: 0.5,
      strokeWeight: 12,
      zIndex: 999,
    });

    routeBorder.setMap(mapRef.current);
    routePath.setMap(mapRef.current);
    
    // Store both for clearing
    currentRouteRef.current = {
      path: routePath,
      border: routeBorder,
      setMap: (map: any) => {
        routePath.setMap(map);
        routeBorder.setMap(map);
      }
    };
    
    // Auto-center on the route
    const bounds = new window.google.maps.LatLngBounds();
    coordinates.forEach(coord => bounds.extend(coord));
    mapRef.current.fitBounds(bounds, { padding: 50 });
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
              <div>{msg.text}</div>
              {msg.details && (
                <details style={{ marginTop: '8px', fontSize: '0.75rem', opacity: 0.8 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Query Preview</summary>
                  <pre style={{ 
                    marginTop: '4px', 
                    padding: '8px', 
                    background: 'rgba(0,0,0,0.05)', 
                    borderRadius: '4px', 
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'monospace'
                  }}>
                    {msg.details}
                  </pre>
                </details>
              )}
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
