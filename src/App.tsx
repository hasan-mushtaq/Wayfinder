import React, { useEffect, useState, useRef } from 'react';

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
  const mapRef = useRef<any>(null);
  const messageEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom of chat
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initialize Map
  useEffect(() => {
    window.initMap = async () => {
      const center = { lat: 37.329, lng: -121.888 };
      const mapOptions = {
        zoom: 18,
        center: center,
        mapId: 'DEMO_MAP_ID', // Optional: for advanced styling
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
        
        // Add a marker for the museum
        new window.google.maps.Marker({
          position: center,
          map: map,
          title: "Wayfinder Main Entrance"
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
              return [...prev, {
                id: 'mock-warning-static',
                text: '💡 Note: Using mock map data for this preview because the live Spanner API is restricted in this environment. The live connection will work when deployed to your production project.',
                sender: 'ai'
              }];
            });
          }
          
          // Style the GeoJSON features
          map.data.setStyle((feature: any) => {
            const category = feature.getProperty('category');
            const nodeType = feature.getProperty('node_type');
            
            let color = '#007aff'; // Default blue
            if (category === 'exhibit') color = '#ff3b30'; // Red
            if (category === 'facility') color = '#34c759'; // Green
            if (nodeType === 'unit') color = '#5856d6'; // Purple
            if (nodeType === 'room') color = '#ff9500'; // Orange
            
            return {
              fillColor: color,
              strokeColor: color,
              strokeWeight: 2,
              fillOpacity: 0.3,
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 6,
                fillColor: color,
                fillOpacity: 0.8,
                strokeWeight: 1
              }
            };
          });

          // Show info window on click
          const infoWindow = new window.google.maps.InfoWindow();
          map.data.addListener('click', (event: any) => {
            const name = event.feature.getProperty('name');
            const category = event.feature.getProperty('category');
            const nodeType = event.feature.getProperty('node_type');
            const venue = event.feature.getProperty('venue_name');
            const floor = event.feature.getProperty('floor_number');
            const level = event.feature.getProperty('level_name');
            const searchContext = event.feature.getProperty('search_context');
            
            infoWindow.setContent(`
              <div style="padding: 12px; font-family: sans-serif; max-width: 250px;">
                <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #1a1a1a;">${name || 'Unnamed Node'}</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
                  <span style="background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #666;">${category || 'No Category'}</span>
                  <span style="background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; color: #666;">${nodeType || 'No Type'}</span>
                </div>
                <div style="font-size: 13px; color: #444; margin-bottom: 4px;">
                  <strong>Venue:</strong> ${venue || 'N/A'}
                </div>
                <div style="font-size: 13px; color: #444; margin-bottom: 4px;">
                  <strong>Floor:</strong> ${floor || 'N/A'} (${level || 'N/A'})
                </div>
                ${searchContext ? `<div style="font-size: 12px; color: #888; margin-top: 8px; font-style: italic;">${searchContext}</div>` : ''}
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
        <div id="map"></div>
      </div>
    </div>
  );
}
