import mongoose from 'mongoose';

// High-performance area code geolocation model for distance calculations
const areaCodeLocationSchema = new mongoose.Schema({
  areaCode: {
    type: String,
    required: true,
    index: true,
    maxlength: 3,
    validate: {
      validator: function(v) {
        return /^\d{3}$/.test(v);
      },
      message: 'Area code must be exactly 3 digits'
    }
  },
  city: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  state: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  country: {
    type: String,
    required: true,
    default: 'US',
    maxlength: 2
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      validate: {
        validator: function(v) {
          return v.length === 2 &&
                 v[0] >= -180 && v[0] <= 180 &&  // longitude
                 v[1] >= -90 && v[1] <= 90;      // latitude
        },
        message: 'Invalid coordinates'
      }
    }
  },
  // Cached distance calculations for optimization
  distanceCache: {
    type: Map,
    of: Number,
    default: new Map()
  }
}, {
  timestamps: false,
  versionKey: false
});

// Create geospatial index for distance queries
areaCodeLocationSchema.index({ location: '2dsphere' });

// Compound index for area code lookups
areaCodeLocationSchema.index({
  areaCode: 1,
  state: 1
}, {
  name: 'area_code_state_lookup',
  background: true
});

// Geographic region index
areaCodeLocationSchema.index({
  country: 1,
  state: 1,
  city: 1
}, {
  name: 'geographic_hierarchy',
  background: true
});

// Static method to calculate distance between two area codes
areaCodeLocationSchema.statics.calculateDistance = function(areaCode1, areaCode2) {
  return this.aggregate([
    {
      $facet: {
        location1: [
          { $match: { areaCode: areaCode1 } },
          { $limit: 1 }
        ],
        location2: [
          { $match: { areaCode: areaCode2 } },
          { $limit: 1 }
        ]
      }
    },
    {
      $project: {
        distance: {
          $cond: {
            if: {
              $and: [
                { $gt: [{ $size: '$location1' }, 0] },
                { $gt: [{ $size: '$location2' }, 0] }
              ]
            },
            then: {
              $let: {
                vars: {
                  loc1: { $arrayElemAt: ['$location1', 0] },
                  loc2: { $arrayElemAt: ['$location2', 0] }
                },
                in: {
                  // Calculate distance using Haversine formula (in miles)
                  $multiply: [
                    3959, // Earth's radius in miles
                    {
                      $acos: {
                        $add: [
                          {
                            $multiply: [
                              { $sin: { $degreesToRadians: { $arrayElemAt: ['$$loc1.location.coordinates', 1] } } },
                              { $sin: { $degreesToRadians: { $arrayElemAt: ['$$loc2.location.coordinates', 1] } } }
                            ]
                          },
                          {
                            $multiply: [
                              { $cos: { $degreesToRadians: { $arrayElemAt: ['$$loc1.location.coordinates', 1] } } },
                              { $cos: { $degreesToRadians: { $arrayElemAt: ['$$loc2.location.coordinates', 1] } } },
                              { $cos: {
                                $degreesToRadians: {
                                  $subtract: [
                                    { $arrayElemAt: ['$$loc2.location.coordinates', 0] },
                                    { $arrayElemAt: ['$$loc1.location.coordinates', 0] }
                                  ]
                                }
                              } }
                            ]
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            },
            else: null
          }
        },
        areaCode1: areaCode1,
        areaCode2: areaCode2
      }
    }
  ]);
};

// Find area codes within a certain distance of a target area code
areaCodeLocationSchema.statics.findNearbyAreaCodes = function(areaCode, maxDistanceMiles = 50) {
  return this.aggregate([
    // First get the target area code location
    {
      $facet: {
        target: [
          { $match: { areaCode: areaCode } },
          { $limit: 1 }
        ],
        all: [
          { $match: { areaCode: { $ne: areaCode } } }
        ]
      }
    },
    {
      $unwind: '$target'
    },
    {
      $unwind: '$all'
    },
    {
      $addFields: {
        distance: {
          $multiply: [
            3959, // Earth's radius in miles
            {
              $acos: {
                $add: [
                  {
                    $multiply: [
                      { $sin: { $degreesToRadians: { $arrayElemAt: ['$target.location.coordinates', 1] } } },
                      { $sin: { $degreesToRadians: { $arrayElemAt: ['$all.location.coordinates', 1] } } }
                    ]
                  },
                  {
                    $multiply: [
                      { $cos: { $degreesToRadians: { $arrayElemAt: ['$target.location.coordinates', 1] } } },
                      { $cos: { $degreesToRadians: { $arrayElemAt: ['$all.location.coordinates', 1] } } },
                      { $cos: {
                        $degreesToRadians: {
                          $subtract: [
                            { $arrayElemAt: ['$all.location.coordinates', 0] },
                            { $arrayElemAt: ['$target.location.coordinates', 0] }
                          ]
                        }
                      } }
                    ]
                  }
                ]
              }
            }
          ]
        }
      }
    },
    {
      $match: {
        distance: { $lte: maxDistanceMiles }
      }
    },
    {
      $project: {
        areaCode: '$all.areaCode',
        city: '$all.city',
        state: '$all.state',
        distance: 1
      }
    },
    {
      $sort: { distance: 1 }
    },
    {
      $limit: 100 // Limit results for performance
    }
  ]).allowDiskUse(true);
};

// Find optimal area code based on target coordinates
areaCodeLocationSchema.statics.findOptimalAreaCode = function(targetLat, targetLng, excludeAreaCodes = []) {
  const targetPoint = [targetLng, targetLat]; // GeoJSON format: [longitude, latitude]

  return this.aggregate([
    {
      $geoNear: {
        near: {
          type: 'Point',
          coordinates: targetPoint
        },
        distanceField: 'distance',
        distanceMultiplier: 0.000621371, // Convert meters to miles
        spherical: true,
        query: excludeAreaCodes.length > 0 ?
          { areaCode: { $nin: excludeAreaCodes } } : {}
      }
    },
    {
      $group: {
        _id: '$areaCode',
        closestCity: { $first: '$city' },
        state: { $first: '$state' },
        avgDistance: { $avg: '$distance' },
        minDistance: { $min: '$distance' },
        cityCount: { $sum: 1 }
      }
    },
    {
      $sort: { avgDistance: 1, cityCount: -1 }
    },
    {
      $limit: 10
    }
  ]);
};

// Get geographic distribution statistics
areaCodeLocationSchema.statics.getGeographicStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: {
          state: '$state',
          areaCode: '$areaCode'
        },
        cityCount: { $sum: 1 },
        cities: { $push: '$city' }
      }
    },
    {
      $group: {
        _id: '$_id.state',
        areaCodeCount: { $sum: 1 },
        totalCities: { $sum: '$cityCount' },
        areaCodes: { $push: '$_id.areaCode' }
      }
    },
    {
      $sort: { areaCodeCount: -1 }
    }
  ]);
};

// Bulk insert method for CSV import
areaCodeLocationSchema.statics.bulkImportFromCSV = async function(csvData) {
  const bulkOps = [];
  const lines = csvData.trim().split('\n');

  for (const line of lines) {
    const [areaCode, city, state, country, lat, lng] = line.split(',').map(field =>
      field.replace(/^"|"$/g, '').trim() // Remove quotes and trim
    );

    if (areaCode && city && state && lat && lng) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lng);

      // Validate coordinates
      if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
        bulkOps.push({
          updateOne: {
            filter: {
              areaCode: areaCode,
              city: city,
              state: state
            },
            update: {
              $set: {
                areaCode: areaCode,
                city: city,
                state: state,
                country: country || 'US',
                location: {
                  type: 'Point',
                  coordinates: [longitude, latitude]
                }
              }
            },
            upsert: true
          }
        });
      }
    }

    // Process in batches of 1000 for better performance
    if (bulkOps.length >= 1000) {
      await this.bulkWrite(bulkOps, { ordered: false });
      bulkOps.length = 0; // Clear array
    }
  }

  // Process remaining operations
  if (bulkOps.length > 0) {
    await this.bulkWrite(bulkOps, { ordered: false });
  }

  return { imported: lines.length };
};

const AreaCodeLocation = mongoose.model('AreaCodeLocation', areaCodeLocationSchema);

export default AreaCodeLocation;