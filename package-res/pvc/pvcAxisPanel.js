/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*global pvc_ValueLabelVar:true */

/**
 * AxisPanel panel.
 */
def
.type('pvc.AxisPanel', pvc.BasePanel)
.init(function(chart, parent, axis, options) {

    options = def.create(options, {
        anchor: axis.option('Position')
    });

    var anchor = options.anchor || this.anchor;

    // Prevent the border from affecting the box model,
    // providing a static 0 value, independently of the actual drawn value...
    //this.borderWidth = 0;

    this.axis = axis; // must be set before calling base, because of log id

    this.base(chart, parent, options);


    this.roleName = axis.role.name;
    this.isDiscrete = axis.role.isDiscrete();
    this._extensionPrefix = axis.extensionPrefixes;

    if(this.labelSpacingMin == null){
        // The user tolerance for "missing" stuff is much smaller with discrete data
        this.labelSpacingMin = this.isDiscrete ? 0.25 : 1.5; // em
    }

    if(this.showTicks == null){
        this.showTicks = !this.isDiscrete;
    }

    if(options.font === undefined){
        var extFont = this._getConstantExtension('label', 'font');
        if(extFont){
            this.font = extFont;
        }
    }

    if(options.tickLength === undefined){
        // height or width
        // TODO: Document the use of width/height for finding the tick length.
        var tickLength = +this._getConstantExtension('ticks', this.anchorOrthoLength(anchor));
        if(!isNaN(tickLength) && isFinite(tickLength)){
            this.tickLength = tickLength;
        }
    }
})
.add({
    pvRule:     null,
    pvTicks:    null,
    pvLabel:    null,
    pvRuleGrid: null,
    pvScale:    null,

    isDiscrete: false,
    roleName: null,
    axis: null,
    anchor: "bottom",
    tickLength: 6,

    scale: null,
    ruleCrossesMargin: true,
    font: '9px sans-serif', // label font
    labelSpacingMin: null,
    // To be used in linear scales
    desiredTickCount: null,
    showMinorTicks:   true,
    showTicks:        null,

    // bullet:       "\u2022"
    // middle-point: "\u00B7"
    // this.isAnchorTopOrBottom() ? ".." : ":"
    hiddenLabelText: "\u00B7",

    _isScaleSetup: false,

    _createLogInstanceId: function(){
        return this.base() + " - " + this.axis.id;
    },

    getTicks: function(){
        return this._layoutInfo && this._layoutInfo.ticks;
    },

    _calcLayout: function(layoutInfo){

        var scale = this.axis.scale;

        // First time setup
        if(!this._isScaleSetup){
            this.pvScale = scale;
            this.scale   = scale; // TODO: At least HeatGrid depends on this. Maybe Remove?

            this.extend(scale, "scale"); // TODO - review extension interface - not documented

            this._isScaleSetup = true;
        }

        if(scale.isNull){
            layoutInfo.axisSize = 0;
        } else {
            this._calcLayoutCore(layoutInfo);
        }

        return this.createAnchoredSize(layoutInfo.axisSize, layoutInfo.clientSize);
    },

    _calcLayoutCore: function(layoutInfo){
        // Fixed axis size?
        var axisSize = layoutInfo.desiredClientSize[this.anchorOrthoLength()];

        layoutInfo.axisSize = axisSize; // may be undefined

        if (this.isDiscrete && this.useCompositeAxis){
            // TODO: composite axis auto axisSize determination
            if(layoutInfo.axisSize == null){
                layoutInfo.axisSize = 50;
            }
        } else {
            this._readTextProperties(layoutInfo);

            /* I  - Calculate ticks
             * --> layoutInfo.{ ticks, ticksText, maxTextWidth }
             */
            this._calcTicks();

            if(this.scale.type === 'discrete'){
                this._tickIncludeModulo = this._calcDiscreteTicksIncludeModulo();
            }

            /* II - Calculate NEEDED axisSize so that all tick's labels fit */
            this._calcAxisSizeFromLabel(layoutInfo); // -> layoutInfo.requiredAxisSize, layoutInfo.maxLabelBBox, layoutInfo.ticksBBoxes

            if(layoutInfo.axisSize == null){
                layoutInfo.axisSize = layoutInfo.requiredAxisSize;
            }

            /* III - Calculate Trimming Length if: FIXED/NEEDED > AVAILABLE */
            this._calcMaxTextLengthThatFits();

            /* IV - Calculate overflow paddings */
            this._calcOverflowPaddings();
        }
    },

    _calcAxisSizeFromLabel: function(layoutInfo){
        this._calcTicksLabelBBoxes(layoutInfo);
        this._calcAxisSizeFromLabelBBox(layoutInfo);
    },

    _readTextProperties: function(layoutInfo){
        var textAngle = this._getExtension('label', 'textAngle');
        layoutInfo.isTextAngleFixed = (textAngle != null);

        layoutInfo.textAngle  = def.number.as(textAngle, 0);
        layoutInfo.textMargin = def.number.as(this._getExtension('label', 'textMargin'), 3);

        var align = this._getExtension('label', 'textAlign');
        if(typeof align !== 'string'){
            align = this.isAnchorTopOrBottom() ?
                    "center" :
                    (this.anchor == "left") ? "right" : "left";
        }
        layoutInfo.textAlign = align;

        var baseline = this._getExtension('label', 'textBaseline');
        if(typeof baseline !== 'string'){
            switch (this.anchor) {
                case "right":
                case "left":
                case "center":
                    baseline = "middle";
                    break;

                case "bottom":
                    baseline = "top";
                    break;

                default:
                //case "top":
                    baseline = "bottom";
            }
        }
        layoutInfo.textBaseline = baseline;
    },

    _calcAxisSizeFromLabelBBox: function(layoutInfo){
        var maxLabelBBox = layoutInfo.maxLabelBBox;

        // The length not over the plot area
        var length = this._getLabelBBoxQuadrantLength(maxLabelBBox, this.anchor);

        // --------------

        var axisSize = this.tickLength + length;

        // Add equal margin on both sides?
        var angle = maxLabelBBox.sourceAngle;
        if(!(angle === 0 && this.isAnchorTopOrBottom())){
            // Text height already has some free space in that case
            // so no need to add more.
            axisSize += this.tickLength;
        }

        layoutInfo.requiredAxisSize = axisSize;
    },

    _getLabelBBoxQuadrantLength: function(labelBBox, quadrantSide){
        // labelBBox coordinates are relative to the anchor point
        // x points to the right, y points downwards
        //        T
        //        ^
        //        |
        // L  <---0--->  R
        //        |
        //        v
        //        B
        //
        //  +--> xx
        //  |
        //  v yy
        //
        //  x1 <= x2
        //  y1 <= y2
        //
        //  p1 +-------+
        //     |       |
        //     +-------+ p2

        var length;
        switch(quadrantSide){
            case 'left':   length = -labelBBox.x;  break;
            case 'right':  length =  labelBBox.x2; break;
            case 'top':    length = -labelBBox.y;  break;
            case 'bottom': length =  labelBBox.y2; break;
        }

        return Math.max(length, 0);
    },

    _calcOverflowPaddings: function(){
        if(!this._layoutInfo.canChange){
            if(pvc.debug >= 2){
                this._warn("Layout cannot change. Skipping calculation of overflow paddings.");
            }
            return;
        }

        this._calcOverflowPaddingsFromLabelBBox();
    },

    _calcOverflowPaddingsFromLabelBBox: function(){
        var overflowPaddings = null;
        var me = this;
        var li = me._layoutInfo;
        var ticks = li.ticks;
        var tickCount = ticks.length;
        if(tickCount){
            var ticksBBoxes  = li.ticksBBoxes;
            var paddings     = li.paddings;
            var isTopOrBottom = me.isAnchorTopOrBottom();
            var begSide      = isTopOrBottom ? 'left'  : 'bottom';
            var endSide      = isTopOrBottom ? 'right' : 'top';
            var scale        = me.scale;
            var isDiscrete   = scale.type === 'discrete';
            var clientLength = li.clientSize[me.anchorLength()];

            this.axis.setScaleRange(clientLength);

            var evalLabelSideOverflow = function(labelBBox, side, isBegin, index) {
                var sideLength = me._getLabelBBoxQuadrantLength(labelBBox, side);
                if(sideLength > 1) {// small delta to avoid frequent re-layouts... (the reported font height often causes this kind of "error" in BBox calculation)
                    var anchorPosition = scale(isDiscrete ? ticks[index].value : ticks[index]);
                    var sidePosition = isBegin ? (anchorPosition - sideLength) : (anchorPosition + sideLength);
                    var sideOverflow = Math.max(0, isBegin ? -sidePosition : (sidePosition - clientLength));
                    if(sideOverflow > 1) {
                        // Discount this panels' paddings
                        // cause they're, in principle, empty space that can be occupied.
                        sideOverflow -= (paddings[side] || 0);
                        if(sideOverflow > 1) {
                            if(isDiscrete){
                                // reduction of space causes reduction of band width
                                // which in turn usually causes the overflowPadding to increase,
                                // as the size of the text usually does not change.
                                // Ask a little bit more to hit the target faster.
                                sideOverflow *= 1.05;
                            }

                            if(!overflowPaddings) {
                                overflowPaddings= def.set({}, side, sideOverflow);
                            } else {
                                var currrOverflowPadding = overflowPaddings[side];
                                if(currrOverflowPadding == null ||
                                   (currrOverflowPadding < sideOverflow)){
                                    overflowPaddings[side] = sideOverflow;
                                }
                            }
                        }
                    }
                }
            };

            ticksBBoxes.forEach(function(labelBBox, index){
                evalLabelSideOverflow(labelBBox, begSide, true,  index);
                evalLabelSideOverflow(labelBBox, endSide, false, index);
            });

            if(pvc.debug >= 6 && overflowPaddings){
                me._log("OverflowPaddings = " + pvc.stringify(overflowPaddings));
            }
        }

        li.overflowPaddings = overflowPaddings;
    },

    _calcMaxTextLengthThatFits: function(){
        var layoutInfo = this._layoutInfo;

        if(this.compatVersion() <= 1){
            layoutInfo.maxTextWidth = null;
            return;
        }

        var availableClientLength = layoutInfo.clientSize[this.anchorOrthoLength()];

        var efSize = Math.min(layoutInfo.axisSize, availableClientLength);
        if(efSize >= (layoutInfo.requiredAxisSize - this.tickLength)){ // let overflow by at most tickLength
            // Labels fit
            // Clear to avoid any unnecessary trimming
            layoutInfo.maxTextWidth = null;
        } else {
            // Text may not fit.
            // Calculate maxTextWidth where text is to be trimmed.
            var maxLabelBBox = layoutInfo.maxLabelBBox;

            // Now move backwards, to the max text width...
            var maxOrthoLength = efSize - 2 * this.tickLength;

            // A point at the maximum orthogonal distance from the anchor
            // Points in the outwards orthogonal direction.
            var mostOrthoDistantPoint;
            var parallelDirection;
            switch(this.anchor){
                case 'left':
                    parallelDirection = pv.vector(0, 1);
                    mostOrthoDistantPoint = pv.vector(-maxOrthoLength, 0);
                    break;

                case 'right':
                    parallelDirection = pv.vector(0, 1);
                    mostOrthoDistantPoint = pv.vector(maxOrthoLength, 0);
                    break;

                case 'top':
                    parallelDirection = pv.vector(1, 0);
                    mostOrthoDistantPoint = pv.vector(0, -maxOrthoLength);
                    break;

                case 'bottom':
                    parallelDirection = pv.vector(1, 0);
                    mostOrthoDistantPoint = pv.vector(0, maxOrthoLength);
                    break;
            }

            var orthoOutwardsDir = mostOrthoDistantPoint.norm();

            // Intersect the line that passes through mostOrthoDistantPoint,
            // and has the direction parallelDirection with
            // the top side and with the bottom side of the *original* label box.
            var corners = maxLabelBBox.source.points();
            var botL = corners[0];
            var botR = corners[1];
            var topR = corners[2];
            var topL = corners[3];

            var topLRSideDir = topR.minus(topL);
            var botLRSideDir = botR.minus(botL);
            var intersect = pv.SvgScene.lineIntersect;
            var botI = intersect(mostOrthoDistantPoint, parallelDirection, botL, botLRSideDir);
            var topI = intersect(mostOrthoDistantPoint, parallelDirection, topL, topLRSideDir);

            // botI and topI will replace two of the original BBox corners
            // The original corners that are at the side of the
            // the line that passes at mostOrthoDistantPoint and has direction parallelDirection (dividing line)
            // further away to the axis, are to be replaced.

            var sideLRWidth  = maxLabelBBox.sourceTextWidth;
            var maxTextWidth = sideLRWidth;

            var botLI = botI.minus(botL);
            var botLILen = botLI.length();
            if(botLILen <= sideLRWidth && botLI.dot(topLRSideDir) >= 0){
                // botI is between botL and botR
                // One of botL and botR is in one side and
                // the other at the other side of the dividing line.
                // On of the sides will be cut-off.
                // The cut-off side is the one whose points have the biggest
                // distance measured relative to orthoOutwardsDir

                if(botL.dot(orthoOutwardsDir) < botR.dot(orthoOutwardsDir)){
                    // botR is farther, so is on the cut-off side
                    maxTextWidth = botLILen; // surely, botLILen < maxTextWidth
                } else {
                    maxTextWidth = botI.minus(botR).length(); // idem
                }
            }

            var topLI = topI.minus(topL);
            var topLILen = topLI.length();
            if(topLILen <= sideLRWidth && topLI.dot(topLRSideDir) >= 0){
                // topI is between topL and topR

                if(topL.dot(orthoOutwardsDir) < topR.dot(orthoOutwardsDir)){
                    // topR is farther, so is on the cut-off side
                    maxTextWidth = Math.min(maxTextWidth, topLILen);
                } else {
                    maxTextWidth = Math.min(maxTextWidth, topI.minus(topR).length());
                }
            }

            // One other detail.
            // When align (anchor) is center,
            // just cutting on one side of the label original box
            // won't do, because when text is centered, the cut we make in length
            // ends up distributed by both sides...
            if(maxLabelBBox.sourceAlign === 'center'){
                var cutWidth = sideLRWidth - maxTextWidth;

                // Cut same width on the opposite side.
                maxTextWidth -= cutWidth;
            }

            layoutInfo.maxTextWidth = maxTextWidth;

            if(pvc.debug >= 3){
                this._log("Trimming labels' text at length " + maxTextWidth.toFixed(2) + "px maxOrthoLength=" + maxOrthoLength.toFixed(2) + "px");
            }
        }
    },

    // ----------------

    _calcTicks: function(){
        var layoutInfo = this._layoutInfo;

        /**
         * The bbox's width is usually very close to the width of the text.
         * The bbox's height is usually about 1/3 bigger than the height of the text,
         * because it includes space for both the descent and the ascent of the font.
         * We'll compensate this by reducing the height of text.
         */
        layoutInfo.textHeight = pv.Text.fontHeight(this.font) * 2/3;
        layoutInfo.maxTextWidth = null;

        // Reset scale to original un-rounded domain
        this.axis.setTicks(null);

        // update maxTextWidth, ticks and ticksText
        switch(this.scale.type){
            case 'discrete':   this._calcDiscreteTicks();   break;
            case 'timeSeries': this._calcTimeSeriesTicks(); break;
            case 'numeric':    this._calcNumberTicks(layoutInfo); break;
            default: throw def.error.operationInvalid("Undefined axis scale type");
        }

        this.axis.setTicks(layoutInfo.ticks);

        var clientLength = layoutInfo.clientSize[this.anchorLength()];
        this.axis.setScaleRange(clientLength);

        if(layoutInfo.maxTextWidth == null){
            this._calcTicksTextLength(layoutInfo);
        }
    },

    _calcDiscreteTicks: function() {
        var axis = this.axis;
        var layoutInfo = this._layoutInfo;
        layoutInfo.ticks = axis.domainItems();

        // If the discrete data is of a single Date value type,
        // we want to format the category values with an appropriate precision,
        // instead of showing the default label.
        var format, dimType;
        var grouping = axis.role.grouping;
        if(grouping.isSingleDimension &&
           (dimType = grouping.firstDimensionType()) &&
           (dimType.valueType === Date)) {
            
            // Calculate precision from values' extent
            var extent = def.query(axis.domainValues()).range();
            // At least two atoms are required
            if(extent && extent.min !== extent.max) {
                var scale = new pv.Scale.linear(extent.min, extent.max);
                // Force "best" tick and tick format determination
                scale.ticks();
                var tickFormatter = axis.option('TickFormatter');
                if(tickFormatter) { scale.tickFormatter(tickFormatter); }

                var domainValues = axis.domainValues();

                format = function(child, index) {
                    return scale.tickFormat(domainValues[index]);
                };
            }
        }

        if(!format) { format = function(child) { return child.absLabel; }; }

        layoutInfo.ticksText = layoutInfo.ticks.map(format);

        this._clearTicksTextDeps(layoutInfo);
    },

    _clearTicksTextDeps: function(ticksInfo) {
        ticksInfo.maxTextWidth =
        ticksInfo.ticksTextLength =
        ticksInfo.ticksBBoxes = null;
    },

    _calcTimeSeriesTicks: function() {
        this._calcContinuousTicks(this._layoutInfo, this.desiredTickCount);
    },

    _calcNumberTicks: function(/*layoutInfo*/) {
        var desiredTickCount = this.desiredTickCount;
        if(desiredTickCount == null) {
            if(this.isAnchorTopOrBottom()){
                this._calcNumberHTicks();
                return;
            }

            desiredTickCount = this._calcNumberVDesiredTickCount();
        }

        this._calcContinuousTicks(this._layoutInfo, desiredTickCount);
    },

    // --------------

    _calcContinuousTicks: function(ticksInfo, desiredTickCount) {
        this._calcContinuousTicksValue(ticksInfo, desiredTickCount);
        this._calcContinuousTicksText(ticksInfo);
    },

    _calcContinuousTicksValue: function(ticksInfo, desiredTickCount) {
        ticksInfo.ticks = this.axis.calcContinuousTicks(desiredTickCount);

        if(pvc.debug > 4){
            this._log("DOMAIN: " + pvc.stringify(this.scale.domain()));
            this._log("TICKS:  " + pvc.stringify(ticksInfo.ticks));
        }
    },

    _calcContinuousTicksText: function(ticksInfo) {
        var ticksText = ticksInfo.ticksText = ticksInfo.ticks.map(function(tick) { return this.scale.tickFormat(tick); }, this);

        this._clearTicksTextDeps(ticksInfo);

        return ticksText;
    },

    _calcTicksTextLength: function(ticksInfo) {
        var max  = 0;
        var font = this.font;
        var ticksText = ticksInfo.ticksText || this._calcContinuousTicksText(ticksInfo);

        var ticksTextLength = ticksInfo.ticksTextLength = ticksText.map(function(text) {
            var len = pv.Text.measureWidth(text, font);
            if(len > max){ max = len; }
            return len;
        });

        ticksInfo.maxTextWidth = max;
        ticksInfo.ticksBBoxes  = null;

        return ticksTextLength;
    },

    _calcTicksLabelBBoxes: function(ticksInfo) {
        var me = this;
        var li = me._layoutInfo;
        var ticksTextLength = ticksInfo.ticksTextLength ||
                              me._calcTicksTextLength(ticksInfo);

        var maxBBox;
        var maxLen = li.maxTextWidth;

        ticksInfo.ticksBBoxes = ticksTextLength.map(function(len) {
            var labelBBox = me._calcLabelBBox(len);
            if(!maxBBox && len === maxLen) { maxBBox = labelBBox; }
            return labelBBox;
        }, me);

        li.maxLabelBBox = maxBBox;
    },

    _calcLabelBBox: function(textWidth) {
        var li = this._layoutInfo;
        return pvc.text.getLabelBBox(
                    textWidth,
                    li.textHeight,  // shared stuff
                    li.textAlign,
                    li.textBaseline,
                    li.textAngle,
                    li.textMargin);
    },

    // --------------

    _calcDiscreteTicksIncludeModulo: function(){
        var mode = this.axis.option('OverlappedLabelsMode');
        if(mode !== 'hide' && mode !== 'rotatethenhide'){
            return 1;
        }

        var li = this._layoutInfo;
        var ticks = li.ticks;
        var tickCount = ticks.length;
        if(tickCount <= 2) {
            return 1;
        }

        // Calculate includeModulo depending on labelSpacingMin

        // Scale is already setup

        // How much are label anchors separated from each other
        // (in the axis direction)
        var b = this.scale.range().step; // don't use .band, cause it does not include margins...

        var h = li.textHeight;
        var w = li.maxTextWidth;  // Should use the average value?

        if(!(w > 0 && h > 0 && b > 0)){
            return 1;
        }

        // Minimum space that the user wants separating
        // the closest edges of the bounding boxes of two consecutive labels,
        // measured perpendicularly to the label text direction.
        var sMin = h * this.labelSpacingMin; /* parameter in em */

        var sMinH = sMin; // Between baselines

        // Horizontal distance between labels' text is easily taken
        // to the distance between words a the same label.
        // Vertically, it is much easier to differentiate different lines.
        // So the minimum horizontal space between labels has the length
        // a white space character, and sMin is the additional required spacing.
        var spaceW = pv.Text.measureWidth('x', this.font);
        var sMinW  = spaceW + sMin; // Between sides (orthogonal to baseline)

        // The angle that the text makes to the x axis (clockwise,y points downwards)
        var a = li.textAngle;

        // * Effective distance between anchors,
        //   that results from showing only
        //   one in every 'tickIncludeModulo' (tim) ticks.
        //
        //   bEf = (b * tim)
        //
        // * The space that separates the closest edges,
        //   that are parallel to the text direction,
        //   of the bounding boxes of
        //   two consecutive (not skipped) labels:
        //
        //   sBase  = (b * timh) * |sinOrCos(a)| - h;
        //
        // * The same, for the edges orthogonal to the text direction:
        //
        //   sOrtho = (b * timw) * |cosOrSin(a)| - w;
        //
        // * At least one of the distances, sBase or sOrtho must be
        //   greater than or equal to sMin:
        //
        //   NoOverlap If (sBase >= sMin) Or (sOrtho >= sMin)
        //
        // * Resolve each of the inequations in function of tim (timh/timw)
        //

        var isH = this.isAnchorTopOrBottom();
        var sinOrCos = Math.abs( Math[isH ? 'sin' : 'cos'](a) );
        var cosOrSin = Math.abs( Math[isH ? 'cos' : 'sin'](a) );

        var timh = sinOrCos < 1e-8 ? Infinity : Math.ceil((sMinH + h) / (b * sinOrCos));
        var timw = cosOrSin < 1e-8 ? Infinity : Math.ceil((sMinW + w) / (b * cosOrSin));
        var tim  = Math.min(timh, timw);
        if(!isFinite(tim) || tim < 1 || Math.ceil(tickCount / tim) < 2) {
            tim = 1;
        }

        return tim;
    },

    /* # For textAngles we're only interested in the [0, pi/2] range.
         Taking the absolute value of the following two expressions, guarantees:
         * asin from [0, 1] --> [0, pi/2]
         * acos from [0, 1] --> [pi/2, 0]

       # textAngle will assume values from [-pi/2, 0] (<=> [vertical, horizontal])

         var sinOrCos = Math.abs((sMin + h) / bEf);
         var cosOrSin = Math.abs((sMin + w) / bEf);

         var aBase  = Math.asin(sinOrCosVal);
         var aOrtho = Math.acos(cosOrSinVal);
    */

    _tickMultipliers: [1, 2, 5, 10],

    _calcNumberVDesiredTickCount: function() {
        var li = this._layoutInfo;
        var lineHeight   = li.textHeight * (1 + Math.max(0, this.labelSpacingMin /*em*/));
        var clientLength = li.clientSize[this.anchorLength()];

        var tickCountMax = Math.max(1, ~~(clientLength / lineHeight));
        if(tickCountMax <= 1) {
            return 1;
        }

        var domain = this.scale.domain();
        var span   = domain[1] - domain[0];
        if(span <= 0) {
            return tickCountMax;
        }

        var stepMin = span / tickCountMax;

        // TODO: does not account for exponentMin and exponentMax options

        // Find an adequate step = k * 10^n where k={1,2,5} and n is an integer
        var exponMin = Math.floor(pv.log(stepMin, 10));
        var stepBase = Math.pow(10, exponMin);
        var step;

        // stepBase <= stepMin <= stepBase * 10
        // Choose the first/smallest multiplier (among 1,2,5,10)
        // for which step = stepBase * m >= stepMin
        var ms = this._tickMultipliers;
        for(var i = 0 ; i < ms.length ; i++) {
            step = ms[i] * stepBase;
            if(step >= stepMin) {
                break;
            }
        }
        // else [should not happen], keep the highest (10)

        return Math.max(1, Math.floor(span / step));
    },

    _calcNumberHTicks: function(){
        var layoutInfo = this._layoutInfo;
        var clientLength = layoutInfo.clientSize[this.anchorLength()];
        var spacing = layoutInfo.textHeight * Math.max(0, this.labelSpacingMin/*em*/);
        var desiredTickCount = this._calcNumberHDesiredTickCount(spacing);

        var doLog = (pvc.debug >= 7);
        var dir, prevResultTickCount;
        var ticksInfo, lastBelow, lastAbove;
        do {
            if(doLog){ this._log("calculateNumberHTicks TickCount IN desired = " + desiredTickCount); }

            ticksInfo = {};

            this._calcContinuousTicksValue(ticksInfo, desiredTickCount);

            var ticks = ticksInfo.ticks;

            var resultTickCount = ticks.length;

            if(ticks.exponentOverflow){
                // TODO: Check if this part of the algorithm is working ok

                // Cannot go anymore in the current direction, if any
                if(dir == null){
                    if(ticks.exponent === this.exponentMin){
                        lastBelow = ticksInfo;
                        dir =  1;
                    } else {
                        lastAbove = ticksInfo;
                        dir = -1;
                    }
                } else if(dir === 1){
                    if(lastBelow){
                        ticksInfo = lastBelow;
                    }
                    break;
                } else { // dir === -1
                    if(lastAbove){
                        ticksInfo = lastAbove;
                    }
                    break;
                }

            } else if(prevResultTickCount == null || resultTickCount !== prevResultTickCount){

                if(doLog){
                    this._log("calculateNumberHTicks TickCount desired/resulting = " + desiredTickCount + " -> " + resultTickCount);
                }

                prevResultTickCount = resultTickCount;

                this._calcContinuousTicksText(ticksInfo);

                var length = this._calcNumberHLength(ticksInfo, spacing);
                var excessLength = ticksInfo.excessLength = length - clientLength;
                var pctError = ticksInfo.error = Math.abs(excessLength / clientLength);

                if(doLog){
                    this._log("calculateNumberHTicks error=" + (excessLength >= 0 ? "+" : "-") + (ticksInfo.error * 100).toFixed(0) + "% count=" + resultTickCount + " step=" + ticks.step);
                    this._log("calculateNumberHTicks Length client/resulting = " + clientLength + " / " + length + " spacing = " + spacing);
                }

                if(excessLength > 0){
                    // More ticks than can fit
                    if(desiredTickCount === 1){
                        // Edge case
                        // Cannot make dir = -1 ...
                        if(resultTickCount === 3 && pctError <= 1){
                         // remove the middle tick
                            ticksInfo.ticks.splice(1,1);
                            ticksInfo.ticksText.splice(1,1);
                            ticksInfo.ticks.step *= 2;
                        } else {
                         // keep only the first tick
                            ticksInfo.ticks.length = 1;
                            ticksInfo.ticksText.length = 1;
                        }
                        delete ticksInfo.maxTextWidth;
                        break;
                    }

                    if(lastBelow){
                        // We were below max length and then overshot...
                        // Choose the best conforming one
                        // Always choose the one that conforms to MinSpacing
                        //if(pctError > lastBelow.error){
                            ticksInfo = lastBelow;
                        //}
                        break;
                    }

                    // Backup last *above* calculation
                    lastAbove = ticksInfo;

                    dir = -1;
                } else {
                    // Less ticks than could fit

                    if(pctError <= 0.05 || dir === -1){
                        // Acceptable
                        // or
                        // Already had exceeded the length and had decided to go down
//                        if(lastAbove && pctError > lastAbove.error){
//                            ticksInfo = lastAbove;
//                        }

                        break;
                    }

                    // Backup last *below* calculation
                    lastBelow = ticksInfo;

                    dir = +1;
                }
            }

            desiredTickCount += dir;
        } while(true);

        if(ticksInfo) {
            layoutInfo.ticks = ticksInfo.ticks;
            layoutInfo.ticksText = ticksInfo.ticksText;
            layoutInfo.maxTextWidth = ticksInfo.maxTextWidth;

            if(pvc.debug >= 5) {
                this._log("calculateNumberHTicks RESULT error=" + (ticksInfo.excessLength >= 0 ? "+" : "-") + (ticksInfo.error * 100).toFixed(0) + "% count=" + ticksInfo.ticks.length + " step=" + ticksInfo.ticks.step);
            }
        }

        if(doLog){ this._log("calculateNumberHTicks END"); }
    },

    _calcNumberHDesiredTickCount: function(spacing){
        // The initial tick count is determined
        // from the formatted min and max values of the domain.
        var layoutInfo = this._layoutInfo;
        var domainTextLength = this.scale.domain().map(function(tick){
                tick = +tick.toFixed(2); // crop some decimal places...
                var text = this.scale.tickFormat(tick);
                return pv.Text.measureWidth(text, this.font);
            }, this);

        var avgTextLength = Math.max((domainTextLength[1] + domainTextLength[0]) / 2, layoutInfo.textHeight);

        var clientLength = layoutInfo.clientSize[this.anchorLength()];

        return Math.max(1, ~~(clientLength / (avgTextLength + spacing)));
    },

    _calcNumberHLength: function(ticksInfo, spacing){
        // Measure full width, with spacing
        var ticksText = ticksInfo.ticksText;
        var maxTextWidth =
            def.query(ticksText)
                .select(function(text){
                    return pv.Text.measureWidth(text, this.font);
                }, this)
                .max();

        /*
         * Include only half the text width on edge labels,
         * cause centered labels are the most common scenario.
         *
         * |w s ww s ww s w|
         *
         */
        return Math.max(maxTextWidth, (ticksText.length - 1) * (maxTextWidth + spacing));
    },

    _createCore: function() {
        if(this.scale.isNull) { return; }

        // Range
        var clientSize = this._layoutInfo.clientSize;
        var paddings   = this._layoutInfo.paddings;

        var begin_a = this.anchorOrtho();
        var end_a   = this.anchorOpposite(begin_a);
        var size_a  = this.anchorOrthoLength(begin_a);

        var rMin = this.ruleCrossesMargin ? -paddings[begin_a] : 0;
        var rMax = clientSize[size_a] + (this.ruleCrossesMargin ? paddings[end_a] : 0);
        var rSize = rMax - rMin;

        this._rSize = rSize;

        var rootScene = this._getRootScene();

        this.pvRule = new pvc.visual.Rule(this, this.pvPanel, {
                extensionId: 'rule'
            })
            .lock('data', [rootScene])
            .override('defaultColor', def.fun.constant("#666666"))
            // ex: anchor = bottom
            .lock(this.anchorOpposite(), 0) // top (of the axis panel)
            .lock(begin_a, rMin )  // left
            .lock(size_a,  rSize) // width
            .pvMark
            .zOrder(30)
            .strokeDasharray(null) // don't inherit from parent panel
            .lineCap('square')     // So that begin/end ticks better join with the rule
            ;

        if (this.isDiscrete){
            if(this.useCompositeAxis){
                this.renderCompositeOrdinalAxis();
            } else {
                this.renderOrdinalAxis();
            }
        } else {
            this.renderLinearAxis();
        }
    },

    _getExtensionId: function(){
        return ''; // NOTE: this is different from specifying null
    },

    _getRootScene: function() {
        if(!this._rootScene) {
            var rootScene =
                this._rootScene =
                new pvc.visual.CartesianAxisRootScene(null, {
                    panel:  this,
                    source: this._getRootData()
                });

            var layoutInfo = this._layoutInfo;
            var ticks      = layoutInfo.ticks;
            var ticksText  = layoutInfo.ticksText;
            if(this.isDiscrete) {
                if(this.useCompositeAxis) {
                    this._buildCompositeScene(rootScene);
                } else {
                    var includeModulo   = this._tickIncludeModulo;
                    var hiddenLabelText = this.hiddenLabelText;

                    rootScene.vars.tickIncludeModulo = includeModulo;
                    rootScene.vars.hiddenLabelText   = hiddenLabelText;

                    var hiddenDatas, hiddenTexts, createHiddenScene, hiddenIndex;
                    if(includeModulo > 2) {
                        if(pvc.debug >= 3) {
                            this._info("Showing only one in every " + includeModulo + " tick labels");
                        }
                        
                        var keySep = rootScene.group.owner.keySep;

                        createHiddenScene = function() {
                            var k = hiddenDatas.map(function(d) { return d.key; }).join(keySep);
                            var l = hiddenTexts.slice(0, 10).join(', ') + (hiddenTexts.length > 10 ? ', ...' : '');
                            var scene = new pvc.visual.CartesianAxisTickScene(rootScene, {
                                source:    hiddenDatas,
                                tick:      k,
                                tickRaw:   k,
                                tickLabel: l,
                                isHidden:  true
                            });
                            scene.dataIndex = hiddenIndex;
                            hiddenDatas = hiddenTexts = hiddenIndex = null;
                        };
                    }

                    ticks.forEach(function(tickData, index){
                        var isHidden = (index % includeModulo) !== 0;
                        if(isHidden && includeModulo > 2) {
                            if(hiddenIndex == null){ hiddenIndex = index; }
                            (hiddenDatas || (hiddenDatas = [])).push(tickData);
                            (hiddenTexts || (hiddenTexts = [])).push(ticksText[index]);
                        } else {
                            if(hiddenDatas) { createHiddenScene(); }
                            var scene = new pvc.visual.CartesianAxisTickScene(rootScene, {
                                source:    tickData,
                                tick:      tickData.value,
                                tickRaw:   tickData.rawValue,
                                tickLabel: ticksText[index],
                                isHidden:  isHidden
                            });

                            scene.dataIndex = index;
                        }
                    });

                    if(hiddenDatas) { createHiddenScene(); }
                }
            } else {
                ticks.forEach(function(majorTick, index){
                    var scene = new pvc.visual.CartesianAxisTickScene(rootScene, {
                        tick:      majorTick,
                        tickRaw:   majorTick,
                        tickLabel: ticksText[index]
                    });
                    scene.dataIndex = index;
                }, this);
            }
        }

        return this._rootScene;
    },

    _buildCompositeScene: function(rootScene){

        var isV1Compat = this.compatVersion() <= 1;

        // Need this for code below not to throw when drawing the root
        rootScene.vars.tick = new pvc_ValueLabelVar('', "");

        recursive(rootScene);

        function recursive(scene){
            var data = scene.group;
            if(isV1Compat){
                // depending on the specific version the
                // properties nodeLabel and label existed as well
                var tickVar = scene.vars.tick;
                scene.nodeValue = scene.value = tickVar.rawValue;
                scene.nodeLabel = scene.label = tickVar.label;
            }

            if(data.childCount()){
                data
                    .children()
                    .each(function(childData){
                        var childScene = new pvc.visual.CartesianAxisTickScene(scene, {
                            source:    childData,
                            tick:      childData.value,
                            tickRaw:   childData.rawValue,
                            tickLabel: childData.label
                        });
                        childScene.dataIndex = childData.childIndex();
                        recursive(childScene);
                    });
            }
        }
    },

    _getRootData: function() {
        var data;
        if(this.isDiscrete && this.useCompositeAxis) {
            // TODO: this is very similar to Axis#_createDomainData
            // Yet here, besides the reverse requirement, a group operator
            // different from the axis' default one (Axis#domainGroupOperator) 
            // is needed...
            var orient = this.anchor;
            var ka = {
                visible: this.axis.domainVisibleOnly() ? true  : null,
                isNull:  this.chart.options.ignoreNulls || this.axis.domainIgnoreNulls() ? false : null,
                reverse: orient == 'bottom' || orient == 'left'
            };

            data = this.axis.role.select(this.data, ka);
        } else {
            data = this.data;
        }
        return data;
    },

    renderOrdinalAxis: function(){
        var scale = this.scale,
            hiddenLabelText   = this.hiddenLabelText,
            includeModulo     = this._tickIncludeModulo,
            hiddenStep2       = includeModulo * scale.range().step / 2,
            anchorOpposite    = this.anchorOpposite(),
            anchorLength      = this.anchorLength(),
            anchorOrtho       = this.anchorOrtho(),
            anchorOrthoLength = this.anchorOrthoLength(),
            pvRule            = this.pvRule,
            rootScene         = this._getRootScene(),
            layoutInfo        = this._layoutInfo,
            isV1Compat        = this.compatVersion() <= 1;

        var wrapper;
        if(isV1Compat){
            // For use in child marks of pvTicksPanel
            var DataElement = function(tickVar){
                this.value =
                this.absValue = tickVar.rawValue;
                this.nodeName = '' + (this.value || '');
                this.path = this.nodeName ? [this.nodeName] : [];
                this.label =
                this.absLabel = tickVar.label;
            };

            DataElement.prototype.toString = function(){
                return ''+this.value;
            };

            wrapper = function(v1f){
                return function(tickScene){
                    // Fix index due to the introduction of
                    // pvTicksPanel panel.
                    var markWrapped = Object.create(this);
                    markWrapped.index = this.parent.index;

                    return v1f.call(markWrapped, new DataElement(tickScene.vars.tick));
                };
            };
        }

        // Ticks correspond to each data in datas.
        // Ticks are drawn at the center of each band.

        var pvTicksPanel = new pvc.visual.Panel(this, this.pvPanel, {
                extensionId: 'ticksPanel'
            })
            .lock('data', rootScene.childNodes)
            .lock(anchorOpposite, 0) // top (of the axis panel)
            .lockMark(anchorOrtho, function(tickScene){
                return tickScene.isHidden ?
                       scale(tickScene.previousSibling.vars.tick.value) + hiddenStep2 :
                       scale(tickScene.vars.tick.value);
            })
            .lock('strokeDasharray', null)
            .lock('strokeStyle', null)
            .lock('fillStyle',   null)
            .lock('lineWidth',   0)
            .pvMark
            .zOrder(20) // below axis rule
            ;

        if(isV1Compat || this.showTicks){
            var pvTicks = this.pvTicks = new pvc.visual.Rule(this, pvTicksPanel, {
                    extensionId: 'ticks',
                    wrapper:  wrapper
                })
                .lock('data') // Inherited
                .intercept('visible', function(scene) {
                    return !scene.isHidden && this.delegateExtension(true);
                })
                .optional('lineWidth', 1)
                .lock(anchorOpposite,  0) // top
                .lock(anchorOrtho,     0) // left
                .lock(anchorLength,    null)
                .optional(anchorOrthoLength, this.tickLength * 2/3) // slightly smaller than continuous ticks
                .override('defaultColor', function(){
                    if(isV1Compat) { return pv.Color.names.transparent; }

                    // Inherit ticks color from rule
                    // Control visibility through .visible or lineWidth
                    return pvRule.scene ?
                           pvRule.scene[0].strokeStyle :
                           "#666666";
                })
                .pvMark
                ;
        }

        var font = this.font;
        var maxTextWidth = this._layoutInfo.maxTextWidth;
        if(!isFinite(maxTextWidth)){
            maxTextWidth = 0;
        }

        // An pv anchor on pvTick is not used, on purpose,
        // cause if it were, hidding the tick with .visible,
        // would mess the positioning of the label...
        this.pvLabel = new pvc.visual.Label(
            this,
            pvTicksPanel,
            {
                extensionId:  'label',
                showsInteraction: true,
                noClick:       false,
                noDoubleClick: false,
                noSelect:      false,
                noTooltip:     false,
                noHover:       false, // TODO: to work, scenes would need a common root
                wrapper:       wrapper
            })
            .intercept('visible', function(tickScene) {
                return !tickScene.isHidden  ?
                       this.delegateExtension(true) :
                       !!tickScene.vars.hiddenLabelText;
            })
            .intercept('text', function(tickScene) {
                // Allow late overriding (does not affect layout..)
                var text;
                if(tickScene.isHidden) {
                    text = hiddenLabelText;
                } else {
                    text = this.delegateExtension();
                    if(text === undefined) {
                        text = tickScene.vars.tick.label;
                    }

                    if(maxTextWidth && (!this.showsInteraction() || !tickScene.isActive)) {
                        text = pvc.text.trimToWidthB(maxTextWidth, text, font, "..", false);
                    }
                }

                return text;
             })
            .pvMark
            .zOrder(40) // above axis rule

            .lock(anchorOpposite, this.tickLength)
            .lock(anchorOrtho,    0)

            .font(font)
            .textStyle("#666666")
            .textAlign(layoutInfo.textAlign)
            .textBaseline(layoutInfo.textBaseline)
            ;

        this._debugTicksPanel(pvTicksPanel);
    },

    /** @override */
    _getTooltipFormatter: function(tipOptions) {
        if(this.axis.option('TooltipEnabled')) {

            tipOptions.gravity = this._calcTipsyGravity();

            var tooltipFormat = this.axis.option('TooltipFormat');
            if(tooltipFormat) {
                return function(context) {
                    return tooltipFormat.call(context, context.scene);
                };
            }

            var autoContent = this.axis.option('TooltipAutoContent');
            if(autoContent === 'summary') {
                return this._summaryTooltipFormatter;
            }

            if(autoContent === 'value') {
                tipOptions.isLazy = false;
                return function(context) { return context.scene.vars.tick.label; };
            }
        }
    },

    _debugTicksPanel: function(pvTicksPanel) {
        if(pvc.debug >= 16){ // one more than general debug box model
            var font = this.font;
            var li = this._layoutInfo;
            var ticksBBoxes = li.ticksBBoxes || this._calcTicksLabelBBoxes(li);

            pvTicksPanel
                // Single-point panel (w=h=0)
                .add(pv.Panel)
                    [this.anchorOpposite()](this.tickLength)
                    [this.anchorOrtho()](0)
                    [this.anchorLength()](0)
                    [this.anchorOrthoLength()](0)
                    .fillStyle(null)
                    .strokeStyle(null)
                    .lineWidth(0)
                    .visible(function(tickScene){ return !tickScene.isHidden; })
                 .add(pv.Line)
                    .data(function(scene){
                        var labelBBox = ticksBBoxes[scene.dataIndex];
                        var corners   = labelBBox.source.points();

                        // Close the path
                        if(corners.length > 1){
                            // not changing corners on purpose
                            corners = corners.concat(corners[0]);
                        }

                        return corners;
                    })
                    .left(function(p){ return p.x; })
                    .top (function(p){ return p.y; })
                    .strokeStyle('red')
                    .lineWidth(0.5)
                    .strokeDasharray('-')
                    ;
        }
    },

    renderLinearAxis: function(){
        // NOTE: Includes time series,
        // so "tickScene.vars.tick.value" may be a number or a Date object...

        var scale  = this.scale,
            pvRule = this.pvRule,
            anchorOpposite    = this.anchorOpposite(),
            anchorLength      = this.anchorLength(),
            anchorOrtho       = this.anchorOrtho(),
            anchorOrthoLength = this.anchorOrthoLength(),
            rootScene         = this._getRootScene();

        var wrapper;
        if(this.compatVersion() <= 1){
            wrapper = function(v1f){
                return function(tickScene){
                    // Fix index due to the introduction of
                    // pvTicksPanel panel.
                    var markWrapped = Object.create(this);
                    markWrapped.index = this.parent.index;

                    return v1f.call(markWrapped, tickScene.vars.tick.rawValue);
                };
            };
        }

        var pvTicksPanel = new pvc.visual.Panel(this, this.pvPanel, {
                extensionId: 'ticksPanel'
            })
            .lock('data', rootScene.childNodes)
            .lock(anchorOpposite, 0) // top (of the axis panel)
            .lockMark(anchorOrtho, function(tickScene){
                return scale(tickScene.vars.tick.value);
            })
            .lock('strokeStyle', null)
            .lock('fillStyle',   null)
            .lock('lineWidth',   0)
            .pvMark
            .zOrder(20) // below axis rule
            ;

        if(this.showTicks) {
            // (MAJOR) ticks
            var pvTicks = this.pvTicks = new pvc.visual.Rule(this, pvTicksPanel, {
                    extensionId: 'ticks',
                    wrapper: wrapper
                })
                .lock('data') // Inherited
                .override('defaultColor', function(){
                    // Inherit axis color
                    // Control visibility through color or through .visible
                    // NOTE: the rule only has one scene/instance
                    return pvRule.scene ?
                           pvRule.scene[0].strokeStyle :
                           "#666666";
                })
                .lock(anchorOpposite, 0) // top
                .lock(anchorOrtho,    0) // left
                .lock(anchorLength,   null)
                .optional(anchorOrthoLength, this.tickLength)
                .pvMark;

            // MINOR ticks are between major scale ticks
            if(this.showMinorTicks){
                var layoutInfo = this._layoutInfo;
                var ticks      = layoutInfo.ticks;
                var tickCount  = ticks.length;
                // Assume a linear scale
                var minorTickOffset = tickCount > 1 ?
                        Math.abs(scale(ticks[1]) - scale(ticks[0])) / 2 :
                        0;

                this.pvMinorTicks = new pvc.visual.Rule(this, this.pvTicks, {
                        extensionId: 'minorTicks',
                        wrapper: wrapper
                    })
                    .lock('data') // Inherited
                    .intercept('visible', function(scene) {
                        // The last minor tick isn't visible - only show between major ticks.
                        // Hide if the previous major tick is hidden.
                        var visible = (scene.childIndex() < tickCount - 1) &&
                                      (!pvTicks.scene || pvTicks.scene[0].visible);

                        return visible && this.delegateExtension(true);
                    })
                    .override('defaultColor', function(){
                        // Inherit ticks color
                        // Control visibility through color or through .visible
                        return pvTicks.scene ?
                               pvTicks.scene[0].strokeStyle :
                               pv.Color.names.d;
                    })
                    .lock(anchorOpposite, 0) // top
                    .lock(anchorLength,   null)
                    .optional(anchorOrthoLength, this.tickLength / 2)
                    .lockMark(anchorOrtho, minorTickOffset)
                    .pvMark
                    ;
            }
        }

        this.renderLinearAxisLabel(pvTicksPanel, wrapper);

        this._debugTicksPanel(pvTicksPanel);
    },

    renderLinearAxisLabel: function(pvTicksPanel, wrapper){
        // Labels are visible (only) on MAJOR ticks,
        // On first and last tick care is taken
        // with their H/V alignment so that
        // the label is not drawn off the chart.

        var pvTicks = this.pvTicks;
        var anchorOpposite = this.anchorOpposite();
        var anchorOrtho    = this.anchorOrtho();
        var scale = this.scale;
        var font  = this.font;

        var maxTextWidth = this._layoutInfo.maxTextWidth;
        if(!isFinite(maxTextWidth)){
            maxTextWidth = 0;
        }

        var pvLabel = this.pvLabel = new pvc.visual.Label(this, pvTicksPanel, {
                extensionId: 'label',
                noHover: false,
                showsInteraction: true,
                wrapper: wrapper
            })
            .lock('data') // inherited
            // TODO: Why is this an intercept, instead of a lock, 
            // if control is never given to the extension point?
            .intercept('text', function(tickScene) {
                var text = tickScene.vars.tick.label;
                if(maxTextWidth && (!this.showsInteraction() || !tickScene.isActive)) {
                    text = pvc.text.trimToWidthB(maxTextWidth, text, font, '..', false);
                }
                return text;
             })
            .pvMark
            .lock(anchorOpposite, this.tickLength)
            .lock(anchorOrtho,    0)
            .zOrder(40) // above axis rule
            .font(this.font)
            .textStyle("#666666");

        // Label alignment
        var rootPanel = this.pvPanel.root;
        if(this.isAnchorTopOrBottom()){
            pvLabel
                .textBaseline(anchorOpposite)
                .textAlign(function(tickScene){
                    var absLeft;
                    if(this.index === 0){
                        absLeft = pvLabel.toScreenTransform().transformHPosition(pvLabel.left());
                        if(absLeft <= 0){
                            return 'left'; // the "left" of the text is anchored to the tick's anchor
                        }
                    } else if(this.index === tickScene.parent.childNodes.length - 1) {
                        absLeft = pvLabel.toScreenTransform().transformHPosition(pvLabel.left());
                        if(absLeft >= rootPanel.width()){
                            return 'right'; // the "right" of the text is anchored to the tick's anchor
                        }
                    }

                    return 'center';
                });
        } else {
            pvLabel
                .textAlign(anchorOpposite)
                .textBaseline(function(tickScene){
                    var absTop;
                    if(this.index === 0){
                        absTop = pvLabel.toScreenTransform().transformVPosition(pvLabel.top());
                        if(absTop >= rootPanel.height()){
                            return 'bottom'; // the "bottom" of the text is anchored to the tick's anchor
                        }
                    } else if(this.index === tickScene.parent.childNodes.length - 1) {
                        absTop = pvLabel.toScreenTransform().transformVPosition(pvLabel.top());
                        if(absTop <= 0){
                            return 'top'; // the "top" of the text is anchored to the tick's anchor
                        }
                    }

                    return 'middle';
                });
        }
    },

    // ----------------------------
    // Click / Double-click
    _onV1Click: function(context, handler){
        if(this.isDiscrete && this.useCompositeAxis){
            handler.call(context.pvMark, context.scene, context.event);
        }
    },

    _onV1DoubleClick: function(context, handler){
        if(this.isDiscrete && this.useCompositeAxis){
            handler.call(context.pvMark, context.scene, context.event);
        }
    },

    /** @override */
    _getSelectableMarks: function(){
        if(this.isDiscrete && this.isVisible && this.pvLabel){
            return this.base();
        }
    },

    /////////////////////////////////////////////////
    //begin: composite axis
    renderCompositeOrdinalAxis: function(){
        var isTopOrBottom = this.isAnchorTopOrBottom(),
            axisDirection = isTopOrBottom ? 'h' : 'v',
            diagDepthCutoff = 2, // depth in [-1/(n+1), 1]
            vertDepthCutoff = 2,
            font = this.font;

        var diagMargin = pv.Text.fontHeight(font) / 2;

        var layout = this._pvLayout = this._getCompositeLayoutSingleCluster();

        // See what will fit so we get consistent rotation
        layout.node
            .def("fitInfo", null)
            .height(function(tickScene, e, f){
                // Just iterate and get cutoff
                var fitInfo = pvc.text.getFitInfo(tickScene.dx, tickScene.dy, tickScene.vars.tick.label, font, diagMargin);
                if(!fitInfo.h){
                    if(axisDirection === 'v' && fitInfo.v){ // prefer vertical
                        vertDepthCutoff = Math.min(diagDepthCutoff, tickScene.depth);
                    } else {
                        diagDepthCutoff = Math.min(diagDepthCutoff, tickScene.depth);
                    }
                }

                this.fitInfo(fitInfo);

                return tickScene.dy;
            });

        // label space (left transparent)
        // var lblBar =
        layout.node.add(pv.Bar)
            .fillStyle('rgba(127,127,127,.001)')
            .strokeStyle(function(tickScene){
                if(tickScene.maxDepth === 1 || !tickScene.maxDepth) { // 0, 0.5, 1
                    return null;
                }

                return "rgba(127,127,127,0.3)"; //non-terminal items, so grouping is visible
            })
            .lineWidth( function(tickScene){
                if(tickScene.maxDepth === 1 || !tickScene.maxDepth) {
                    return 0;
                }
                return 0.5; //non-terminal items, so grouping is visible
            })
            .text(function(tickScene){
                return tickScene.vars.tick.label;
            });

        //cutoffs -> snap to vertical/horizontal
        var H_CUTOFF_ANG = 0.30,
            V_CUTOFF_ANG = 1.27;

        var align = isTopOrBottom ?
                    "center" :
                    (this.anchor == "left") ? "right" : "left";

        var wrapper;
        if(this.compatVersion() <= 1){
            wrapper = function(v1f){
                return function(tickScene){
                    return v1f.call(this, tickScene);
                };
            };
        }

        // draw labels and make them fit
        this.pvLabel = new pvc.visual.Label(this, layout.label, {
                extensionId:  'label',
                noClick:       false,
                noDoubleClick: false,
                noSelect:      false,
                noTooltip:     false,
                noHover:       false, // TODO: to work, scenes would need a common root
                showsInteraction: true,
                wrapper:       wrapper,
                tooltipArgs:   {
                    options: {offset: diagMargin * 2}
                }
            })
            .pvMark
            .def('lblDirection', 'h')
            .textAngle(function(tickScene){
                if(tickScene.depth >= vertDepthCutoff && tickScene.depth < diagDepthCutoff){
                    this.lblDirection('v');
                    return -Math.PI/2;
                }

                if(tickScene.depth >= diagDepthCutoff){
                    var tan = tickScene.dy/tickScene.dx;
                    var angle = Math.atan(tan);
                    //var hip = Math.sqrt(tickScene.dy*tickScene.dy + tickScene.dx*tickScene.dx);

                    if(angle > V_CUTOFF_ANG){
                        this.lblDirection('v');
                        return -Math.PI/2;
                    }

                    if(angle > H_CUTOFF_ANG) {
                        this.lblDirection('d');
                        return -angle;
                    }
                }

                this.lblDirection('h');
                return 0;//horizontal
            })
            .textMargin(1)
            //override central alignment for horizontal text in vertical axis
            .textAlign(function(tickScene){
                return (axisDirection != 'v' || tickScene.depth >= vertDepthCutoff || tickScene.depth >= diagDepthCutoff)? 'center' : align;
            })
            .left(function(tickScene) {
                return (axisDirection != 'v' || tickScene.depth >= vertDepthCutoff || tickScene.depth >= diagDepthCutoff)?
                     tickScene.x + tickScene.dx/2 :
                     ((align == 'right')? tickScene.x + tickScene.dx : tickScene.x);
            })
            .font(font)
            .textStyle("#666666")
            .text(function(tickScene){
                var label = tickScene.vars.tick.label;
                if(!tickScene.isActive || !this.sign.showsInteraction()){
                    var fitInfo = this.fitInfo();
                    switch(this.lblDirection()){
                        case 'h':
                            if(!fitInfo.h){
                                return pvc.text.trimToWidthB(tickScene.dx, label, font, '..');
                            }
                            break;
                        case 'v':
                            if(!fitInfo.v){
                                return pvc.text.trimToWidthB(tickScene.dy, label, font, '..');
                            }
                            break;
                        case 'd':
                           if(!fitInfo.d){
                              //var ang = Math.atan(tickScene.dy/tickScene.dx);
                              var diagonalLength = Math.sqrt(def.sqr(tickScene.dy) + def.sqr(tickScene.dx));
                              return pvc.text.trimToWidthB(diagonalLength - diagMargin, label, font, '..');
                            }
                            break;
                    }
                }

                return label;
            })
            ;
    },

    _getCompositeLayoutSingleCluster: function(){
        var rootScene   = this._getRootScene(),
            orientation = this.anchor,
            maxDepth    = rootScene.group.treeHeight,
            depthLength = this._layoutInfo.axisSize;

        // displace to take out bogus-root
        maxDepth++;

        var baseDisplacement = depthLength / maxDepth,
            margin = maxDepth > 2 ? ((1/12) * depthLength) : 0; // heuristic compensation

        baseDisplacement -= margin;

        var scaleFactor = maxDepth / (maxDepth - 1),
            orthoLength = pvc.BasePanel.orthogonalLength[orientation];

        var displacement = (orthoLength == 'width') ?
                (orientation === 'left' ? [-baseDisplacement, 0] : [baseDisplacement, 0]) :
                (orientation === 'top'  ? [0, -baseDisplacement] : [0, baseDisplacement]);

        this.pvRule
            .sign
            .override('defaultColor',       def.fun.constant(null))
            .override('defaultStrokeWidth', def.fun.constant(0)   );

        var panel = this.pvRule
            .add(pv.Panel)
                [orthoLength](depthLength)
                .strokeStyle(null)
                .lineWidth(0) //cropping panel
            .add(pv.Panel)
                [orthoLength](depthLength * scaleFactor)
                .strokeStyle(null)
                .lineWidth(0);// panel resized and shifted to make bogus root disappear

        panel.transform(pv.Transform.identity.translate(displacement[0], displacement[1]));

        // Create with bogus-root
        // pv.Hierarchy must always have exactly one root and
        //  at least one element besides the root
        return panel.add(pv.Layout.Cluster.Fill)
                    .nodes(rootScene.nodes())
                    .orient(orientation);
    },

    _calcTipsyGravity: function(){
        switch(this.anchor){
            case 'bottom': return 's';
            case 'top':    return 'n';
            case 'left':   return 'w';
            case 'right':  return 'e';
        }
        return 's';
    }
    // end: composite axis
    /////////////////////////////////////////////////
});