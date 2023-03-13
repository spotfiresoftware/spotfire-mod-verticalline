// @ts-nocheck
Spotfire.initialize(async function(mod) {
    // Get the visualization element
    const vizElem = document.querySelector(".visualization"); // Plotly target
    
    // Get the render context
    const context = mod.getRenderContext();


    // --------------------------------------------------------------------------------
    // SPOTFIRE DEFINITIONS
    let modDataView = null;
    let axes = {};
    let windowSize = null;
    let markingEnabled = null;

    // --------------------------------------------------------------------------------
    // PLOTLY DATA AND CONFIG
    let redraw = true;
    let data = [];
    let traces = {};
    let backgrounds = {};
    let plotlyConfigStr = null; // exact copy from config as a string
    let plotlyConfigTemplate = null; // exact copy from config as an object
    let plotlyConfig = null; // values passed to plotly


    // --------------------------------------------------------------------------------
    // DATA FUNCTIONS
    // Deep clones an object, kind of
    let clone = function(aObject) {
        if (!aObject) {
            return aObject;
        }

        let v;
        let bObject = Array.isArray(aObject) ? [] : {};
        for (const k in aObject) {
        	v = aObject[k];
        	bObject[k] = (typeof v === "object") ? clone(v) : v;
        }

        return bObject;
    }

    // Creates a new trace object
    let createTrace = function(name) {
        if(plotlyConfig == null) return;
        let trace = null;

        // Start by cloning the trace by name or the default trace if not found
        if(plotlyConfig[name] != null)
            trace = clone(plotlyConfig[name]);
        else
            trace = clone(plotlyConfig.defaultTrace);
        trace.name = name;

        // if there are trace deltas, apply these over top of the base trace
        if(plotlyConfig.traces != null && plotlyConfig.traces[name] != null) {
            let traceDetail = clone(plotlyConfig.traces[name]);
            for(let fieldName in traceDetail) {
                trace[fieldName] = traceDetail[fieldName];
            }
        }

        resetTraceData(trace);

        return trace;
    }

    // Resets the data arrays in the trace
    let resetTraceData = function(trace) {
        trace._prevSelected = trace.selectedpoints != null && trace.selectedpoints.length > 0;
        trace.x = [];
        trace.y = [];
        trace.selectedpoints = [];
        trace._rows = [];
    }

    // Sets the trace axis color
    //   axis - layout axis prefix: x, y, z...
    //   target - target for concurrent axes: null, x, x2, x3...
    //   color - color to set the the line
    let setTraceAxisColor = function(axis, target, color) {
        let axisName = axis + "axis";
        let axisContainer = plotlyConfig.layout;
        if(target != null) {
            axisName = axisName + target.substr(1);
        }
        axisContainer[axisName].linecolor = color;
        axisContainer[axisName].tickcolor = color;
        axisContainer[axisName].tickfont = {
            color: color
        };

        // This doesn't work for some reason
        axisContainer[axisName].titlefont = {
            color: color
        };
    }

    // Returns the trace for the given name. If not found, then it will create one.
    let getTrace = function(name, color) {
        let trace = traces[name];
        if(trace == null) {            
            trace = createTrace(name);
            traces[name] = trace;
            data.push(trace);
        }

        // Set axis colors if enabled
        if(trace.modPushXAxisColor == true) {   
            setTraceAxisColor('x', trace.xaxis, color);        
        }
        if(trace.modPushYAxisColor == true) {   
            setTraceAxisColor('y', trace.yaxis, color);        
        }
        return trace;
    }

    // Generate background definitions
    let generateBackground = function(color, x, y) {
        if(color != null && color != "(Empty)") {                
            let thisBackground = backgrounds[color];
            if(thisBackground == null) {
                thisBackground = {
                    min: y,
                    max: y
                }
                backgrounds[color] = thisBackground;
            }

            if(x < thisBackground.min)
                thisBackground.min = y;
            if(x > thisBackground.max)
                thisBackground.max = y;
        }
    }
    
    // Processes all rows in a set
    let processRows = async function() {
        if(plotlyConfig == null) return;
        if(modDataView == null) return;

        // Get rows
        let rows = await modDataView.allRows();
        if(rows == null) return;

        // Reset arrays
        for(let traceName in traces) {
            let trace = traces[traceName];
            resetTraceData(trace);
        }

        // Reset backgrounds
        backgrounds = {};

        // Reset axis data type
        if(axes["X"].isCategorical == false) {
            let xAxisContinuous = await modDataView.continuousAxis("X");
            if(xAxisContinuous.dataType.isDate())
                plotlyConfig.layout.xaxis.type = "date";
            else
                delete plotlyConfig.layout.xaxis.type;
        }

        if(axes["Y"].isCategorical == false) {
            let yAxisContinuous = await modDataView.continuousAxis("Y");
            if(yAxisContinuous.dataType.isDate())
                plotlyConfig.layout.yaxis.type = "date";
            else
                delete plotlyConfig.layout.yaxis.type;
        }

        // Iterate over rows and push into arrays
        rows.forEach(function(row) {
            // Row value
            let thisRow = {};

            // Get X value
            if(axes["X"].isCategorical == true) {
                if(row.categorical("X").value().length > 0 && row.categorical("X").value()[0].value() != null 
                        && row.categorical("X").value()[0].value() instanceof Date)
                    thisRow.x = row.categorical("X").value()[0].value();
                else
                    thisRow.x = row.categorical("X").formattedValue();
            }
            else {  
                thisRow.x = row.continuous("X").value();
            }

            // Get Y value
            if(axes["Y"].isCategorical == true) {
                if(row.categorical("Y").value().length > 0 && row.categorical("Y").value()[0].value() != null 
                        && row.categorical("Y").value()[0].value() instanceof Date)
                    thisRow.y = row.categorical("Y").value()[0].value();
                else
                    thisRow.y = row.categorical("Y").formattedValue();
            }
            else {
                thisRow.y = row.continuous("Y").value();
            }

            // Get Line by value
            if(axes["Line by"] != null && axes["Line by"].expression != '<>')
                thisRow.lineBy = row.categorical("Line by").formattedValue();
            else
                thisRow.lineBy = '1';

            // Get color background by value
            if(axes["Color background by"] != null && axes["Color background by"].expression != '<>') {
                generateBackground(row.categorical("Color background by").formattedValue(), thisRow.x, thisRow.y);
            }

            // Get color value
            thisRow.color = row.color().hexCode;

            // Get the trace, this will create one if not found
            let trace = getTrace(thisRow.lineBy, thisRow.color);

            // Push the row reference into the trace
            trace._rows.push(row);

            // Push data into the trace
            trace.x.push(thisRow.x);
            trace.y.push(thisRow.y);

            // If row is marked, add the current row to selected points array
            if(row.isMarked() == true) {
                trace.selectedpoints.push(trace._rows.length - 1);
                
                // Set color if there is a selected configuration
                if(trace.selected != null)
                    trace.selected.marker.color = row.color().hexCode;
            }
            // Otherwise set the marker to the color
            else {
                trace.marker.color = row.color().hexCode;
            }

            // Reset autorange, possible plotly bug, sometimes reset to "true"
            let axisContainer = plotlyConfig.layout;
            let axisTemplateContainer = plotlyConfigTemplate.layout;
            if(axisTemplateContainer.xaxis.autorange != null)
                axisContainer.xaxis.autorange = axisTemplateContainer.xaxis.autorange;
            if(axisTemplateContainer.yaxis.autorange != null)    
                axisContainer.yaxis.autorange = axisTemplateContainer.yaxis.autorange;
        });

        // Update the shapes for background coloring
        plotlyConfig.layout.shapes = clone(plotlyConfigTemplate.layout.shapes);
        if(plotlyConfig.layout.shapes == null)
            plotlyConfig.layout.shapes = [];
        for(let thisBackgroundColor in backgrounds) {
            let thisBackground =  backgrounds[thisBackgroundColor];
            let shape = {
                "type": "rect",
                "xref": "paper",
                "yref": "y",
                "x0": 0,
                "y0": thisBackground.min,
                "x1": 1,
                "y1": thisBackground.max,
                "fillcolor": thisBackgroundColor,
                "opacity": 0.2,
                "line": {
                  "width": 0
                }
            };
            plotlyConfig.layout.shapes.push(shape);
        }
    }


    // Format tooltip text
    let formatTooltipText = function(text) {
        return text.replace("<", "").replace(">", "").replace("[", "").replace("]", "");
    }

    // --------------------------------------------------------------------------------
    // PLOTLY ACTIONS
    // Replot the data on a chart
    let replotChart = async function() {
        if(plotlyConfig == null) return;
        Plotly.react(vizElem, data, plotlyConfig.layout, plotlyConfig.options);
    }

    // Draw or redraw the entire chart
    let drawChart = async function() {
        if(plotlyConfig == null) return;   
        if(redraw == false) return await replotChart();

        Plotly.newPlot(vizElem, data, plotlyConfig.layout, plotlyConfig.options);    

        // Change the pointer to default to match Spotfire behaviour
        let dragLayer = document.getElementsByClassName('nsewdrag')
        for(let idx = 0; idx < dragLayer.length; idx++)
            dragLayer[idx].style.cursor = 'default';

        // Add chart event handlers
        addChartEventHandlers();
    }

    // Append chart event handlers
    let addChartEventHandlers = function() {
        // Add click event
        /*vizElem.on('plotly_click', function(eventData) {
            console.log('click');
            console.log(eventData);
        });*/      

        // Add hover event
        vizElem.on('plotly_hover', function(eventData){
            let text = '';
            for(let idx = 0; idx < eventData.points.length; idx++) {
                if(eventData.points[idx].data.name != "1")
                    text = text + formatTooltipText(axes["Line by"].expression) + ": " + eventData.points[idx].data.name + "\n";
                text = text + formatTooltipText(axes["X"].expression) + ": " + eventData.points[idx].x + "\n";
                text = text + formatTooltipText(axes["Y"].expression) + ": " + eventData.points[idx].y + "\n";
            }
            mod.controls.tooltip.show(text, 500);
        });

        // Add unhover event
        vizElem.on('plotly_unhover', function(eventData){
            mod.controls.tooltip.hide();
        });

        // Add selected event
        vizElem.on('plotly_selected', function(eventData) {
            if(eventData != null) {
                for(let idx = 0; idx < eventData.points.length; idx++) {
                    let point = eventData.points[idx];
                    let trace = data[point.curveNumber];
                    let row = trace._rows[point.pointNumber];
                    row.mark();
                }
            }
            return false;
        });           
    }

    // Update plotly marking
    let updateMarking = function() {
        if(plotlyConfig == null) return;
        if(markingEnabled != null)
            plotlyConfig.layout.dragmode = "select";
        else
            plotlyConfig.layout.dragmode = false;
    }


    // --------------------------------------------------------------------------------
    // UI EVENT HANDLERS

    // Register event handler on the viz element to remove selection
    vizElem.onclick = function() {
        for(let traceName in traces) {
            let trace = traces[traceName];
            let selectedpoints = [...trace.selectedpoints];
            for(let idx = 0; idx < selectedpoints.length; idx++) {
                let selectedpoint = trace.selectedpoints[idx];
                let row = trace._rows[selectedpoint];
                row.mark("Toggle");
            }
        }
    }



    // --------------------------------------------------------------------------------
    // DOCUMENT PROPERTIES
    // Convert document properties to an object
    let convertDocumentProperties = function(documentProperties) {
        let properties = {};
        for(let thisDocumentProperty of documentProperties) {
            if(thisDocumentProperty.isList == false) {
                properties["%%" + thisDocumentProperty.name + "%%"] = thisDocumentProperty.value();
            }
        }
        return properties;
    };

    // --------------------------------------------------------------------------------
    // CONFIGURATION
    // Updates the configuration in the property store, this will trigger a redraw
    let updateConfig = function(config) {
        // Split up the config because of max length for property
        const maxSize = 2000;
        const maxConfigs = 3;
        let chop = function(str, size){
            const numChunks = Math.ceil(str.length / size)
            const chunks = new Array(numChunks)          
            for (let i = 0, o = 0; i < numChunks; ++i, o += size) {
              chunks[i] = str.substr(o, size)
            }
            return chunks
        };
        
        let tokens = chop(config, maxSize);
        for(let thisTokenIdx in tokens) {
            let thisToken = tokens[thisTokenIdx];
            mod.property("plotly-config-" + thisTokenIdx).set(thisToken);
        }

        if(tokens.length < maxConfigs) {
            let configIdx = tokens.length;
            for(let idx = configIdx; idx < maxConfigs; idx++ )
                mod.property("plotly-config-" + idx).set("");
        }
    }

    // Process configuration settings
    let processConfiguration = async function(documentProperties) {
        let properties = convertDocumentProperties(documentProperties); 
        vizConfiguration.setProperties(properties); 

        // If there is a configuration string, then process as JSON
        if(plotlyConfigStr != null && plotlyConfigStr.length > 0)  {
            // Apply document properties
            let updatedConfigStr = vizConfiguration.applyProperties(plotlyConfigStr);

            // This is the exact configuration from the config panel
            plotlyConfigTemplate = JSON.parse(updatedConfigStr);

            // This is the configuration that will be passed to Plotly
            plotlyConfig = clone(plotlyConfigTemplate);

            // Reset the data
            data = [];
            traces = {};
            backgrounds = {};

            // Update marking
            updateMarking();

            // Reprocess the rows and draw the chart with updated configuration
            await processRows();
            await drawChart();
        }
    }

    // Get the configuration handler
    //   document - the HTML document
    //   drawChart - function to call when toggling to visualization mode, this
    //     will redraw the Plotly chart due to changes in div sizing
    //   updateConfig - function to call when dialog saves the configuration
    const vizConfiguration = new VizConfiguration(document, drawChart, updateConfig);


    // --------------------------------------------------------------------------------
    // DATA EVENT HANDLER
    // Create a read function for axis changes
    let readAxes = mod.createReader(
        mod.visualization.axis("Line by"), 
        mod.visualization.axis("Color background by"), 
        mod.visualization.axis("X"), 
        mod.visualization.axis("Y"),
        mod.visualization.data(),
        mod.windowSize()
    );

    // Call the read function to schedule an onChange callback (one time)
    readAxes.subscribe(async function onChange(lineByAxisView, colorBackgroundByAxisView, xAxisView, yAxisView, dataView, windowSizeView) {
        // Set redraw flag
        redraw = false;

        // Set axes
        let axesArr = [lineByAxisView, colorBackgroundByAxisView, xAxisView, yAxisView];
        for(let thisAxis of axesArr) {
            let oldAxis = axes[thisAxis.name];
            //let newAxis = await mod.visualization.axis(thisAxis.name);
            let newAxis = thisAxis;
            if(oldAxis != null && newAxis.expression != oldAxis.expression) {
                redraw = true;
            }
            axes[thisAxis.name] = newAxis;
        }

        // Test data view for errors
        let errors = await dataView.getErrors();        
        if(errors.length > 0) {
            mod.controls.errorOverlay.show(errors);
            return;
        }
        else {
            mod.controls.errorOverlay.hide();
        }

        // Set dataView
        modDataView = dataView;

        // Process the data view
        await processRows();

        // Setup marking enabled based on dataView property
        let markingEnabledView = await dataView.marking();
        if(markingEnabled == null && markingEnabledView != null || markingEnabled != null && markingEnabledView == null) {
            markingEnabled = markingEnabledView;
            updateMarking();
            redraw = true;
        }

        // Check window size change and redraw
        if(windowSize == null || windowSizeView != windowSize ) {
            windowSize = windowSizeView;
            redraw = true;
        }

        // Draw or replot
        await drawChart();

        // Complete render
        context.signalRenderComplete();
    })
    


    // Create a read function for plotly configuration
    let readDocumentProperties = mod.createReader(
        mod.document.properties()
    );
    
    // Call the read function to schedule an onChange callback (one time)
    readDocumentProperties.subscribe(async function onChange(documentProperties) {
        // Process the configuration
        await processConfiguration(documentProperties);
    });

    // Create a read function for plotly configuration
    let readPlotlyConfig = mod.createReader(
        mod.property("plotly-config-0"),
        mod.property("plotly-config-1"),
        mod.property("plotly-config-2")
    );
    
    // Call the read function to schedule an onChange callback (one time)
    readPlotlyConfig.subscribe(async function onChange(config0, config1, config2) {
        let configValue0 = await mod.property("plotly-config-0");
        let configValue1 = await mod.property("plotly-config-1");
        let configValue2 = await mod.property("plotly-config-2");
        plotlyConfigStr = configValue0.value().concat(configValue1.value()).concat(configValue2.value());

        // Update the configuration in the configuration handler
        vizConfiguration.setConfiguration(plotlyConfigStr);
        
        // Process the configuration
        let documentProperties = await mod.document.properties();
        await processConfiguration(documentProperties);

        // Complete render
        // context.signalRenderComplete();
    });

}); // end Spotfire
