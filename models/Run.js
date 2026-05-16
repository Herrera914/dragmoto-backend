const mongoose = require('mongoose');

const RunSchema = new mongoose.Schema({
    // Metadata
    created_at:   { type: Number, required: true },
    mode:         { type: String, default: 'Auto Drag' },
    vehicle_name: { type: String, default: 'Default' },
    setup_notes:  { type: String, default: '' },
    user_id:      { type: String, default: 'anonymous' },

    // Speed tests (segundos)
    zero_to_30:       { type: Number, default: null },
    zero_to_60:       { type: Number, default: null },
    zero_to_80:       { type: Number, default: null },
    zero_to_100:      { type: Number, default: null },
    zero_to_120:      { type: Number, default: null },
    sixty_to_hundred: { type: Number, default: null },

    // Distance tests (segundos)
    hundred_meters: { type: Number, default: null },
    eighth_mile:    { type: Number, default: null },
    quarter_mile:   { type: Number, default: null },
    one_km:         { type: Number, default: null },

    // Trap speeds (km/h)
    trap_speed_quarter: { type: Number, default: null },

    // Power
    estimated_power_hp: { type: Number, default: null },

    // Stats generales
    top_speed:         { type: Number, required: true },
    total_distance:    { type: Number, required: true },
    peak_acceleration: { type: Number, default: 0 },
    valid_run:         { type: Boolean, default: true },
    launch_quality:    { type: String, default: null },

    synced_at: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Run', RunSchema);
