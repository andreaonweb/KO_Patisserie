export interface BusArrival {
  lineName:       string;
  destination:    string;
  minutesAway:    number;   
  operator:       'bus' | 'amb';
}

export interface BusStop {
  id:             string;
  name:           string;
  address:        string;
  distanceMeters: number;
  lat:            number;
  lon:            number;
  arrivals:       BusArrival[];  
  loadingArrivals: boolean;
}