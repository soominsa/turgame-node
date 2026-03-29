import { Material } from './types.js';
import { TEMP_AMBIENT, HEAT_CAPACITY } from './constants.js';

export function createWood(mass = 5): Material {
  return {
    type: 'wood',
    mass,
    temperature: TEMP_AMBIENT,
    structure: 4,
    combustibility: 8,
    ignitionTemp: 200,
    thermalState: 'normal',
    conductivity: 0.1,
    heatCapacity: HEAT_CAPACITY.wood,
  };
}

export function createMetal(mass = 7): Material {
  return {
    type: 'metal',
    mass,
    temperature: TEMP_AMBIENT,
    structure: 8,
    combustibility: 0,
    ignitionTemp: Infinity,
    thermalState: 'normal',
    conductivity: 0.8,
    heatCapacity: HEAT_CAPACITY.metal,
  };
}

export function createSoil(mass = 5): Material {
  return {
    type: 'soil',
    mass,
    temperature: TEMP_AMBIENT,
    structure: 5,
    combustibility: 0,
    ignitionTemp: Infinity,
    thermalState: 'normal',
    conductivity: 0.1,
    heatCapacity: HEAT_CAPACITY.soil,
  };
}

export function createWater(mass = 5): Material {
  return {
    type: 'water',
    mass,
    temperature: TEMP_AMBIENT,
    structure: 0,
    combustibility: 0,
    ignitionTemp: Infinity,
    thermalState: 'normal',
    conductivity: 0.3,
    heatCapacity: HEAT_CAPACITY.water,
  };
}
