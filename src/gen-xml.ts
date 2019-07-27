/**
 * PptxGenJS: XML Generation
 */

import {
	BULLET_TYPES,
	CRLF,
	DEF_CELL_BORDER,
	DEF_CELL_MARGIN_PT,
	DEF_FONT_SIZE,
	DEF_SLIDE_MARGIN_IN,
	EMU,
	LAYOUT_IDX_SERIES_BASE,
	LINEH_MODIFIER,
	ONEPT,
	PLACEHOLDER_TYPES,
	SLDNUMFLDID,
	SLIDE_OBJECT_TYPES,
} from './core-enums'
import PptxGenJS from './pptxgen'
import { gObjPptxShapes } from './core-shapes'
import {
	ILayout,
	ISlide,
	IShadowOpts,
	ISlideLayout,
	ITableCell,
	ISlideObject,
	ITableToSlidesOpts,
	ITableToSlidesCell,
	ITableCellOpts,
	ISlideRel,
	ISlideRelChart,
	ISlideRelMedia,
} from './core-interfaces'
import { encodeXmlEntities, inch2Emu, genXmlColorSelection, getSmartParseNumber, convertRotationDegrees, rgbToHex } from './gen-utils'

let imageSizingXml = {
	cover: function(imgSize, boxDim) {
		var imgRatio = imgSize.h / imgSize.w,
			boxRatio = boxDim.h / boxDim.w,
			isBoxBased = boxRatio > imgRatio,
			width = isBoxBased ? boxDim.h / imgRatio : boxDim.w,
			height = isBoxBased ? boxDim.h : boxDim.w * imgRatio,
			hzPerc = Math.round(1e5 * 0.5 * (1 - boxDim.w / width)),
			vzPerc = Math.round(1e5 * 0.5 * (1 - boxDim.h / height))
		return '<a:srcRect l="' + hzPerc + '" r="' + hzPerc + '" t="' + vzPerc + '" b="' + vzPerc + '"/><a:stretch/>'
	},
	contain: function(imgSize, boxDim) {
		var imgRatio = imgSize.h / imgSize.w,
			boxRatio = boxDim.h / boxDim.w,
			widthBased = boxRatio > imgRatio,
			width = widthBased ? boxDim.w : boxDim.h / imgRatio,
			height = widthBased ? boxDim.w * imgRatio : boxDim.h,
			hzPerc = Math.round(1e5 * 0.5 * (1 - boxDim.w / width)),
			vzPerc = Math.round(1e5 * 0.5 * (1 - boxDim.h / height))
		return '<a:srcRect l="' + hzPerc + '" r="' + hzPerc + '" t="' + vzPerc + '" b="' + vzPerc + '"/><a:stretch/>'
	},
	crop: function(imageSize, boxDim) {
		var l = boxDim.x,
			r = imageSize.w - (boxDim.x + boxDim.w),
			t = boxDim.y,
			b = imageSize.h - (boxDim.y + boxDim.h),
			lPerc = Math.round(1e5 * (l / imageSize.w)),
			rPerc = Math.round(1e5 * (r / imageSize.w)),
			tPerc = Math.round(1e5 * (t / imageSize.h)),
			bPerc = Math.round(1e5 * (b / imageSize.h))
		return '<a:srcRect l="' + lPerc + '" r="' + rPerc + '" t="' + tPerc + '" b="' + bPerc + '"/><a:stretch/>'
	},
}

/**
 * Transforms a slide or slideLayout to resulting XML string (slide1.xml)
 * @param {ISlide|ISlideLayout} slideObject slide object created within createSlideObject
 * @return {string} XML string with <p:cSld> as the root
 */
function slideObjectToXml(slide: ISlide | ISlideLayout): string {
	let strSlideXml: string = slide.name ? '<p:cSld name="' + slide.name + '">' : '<p:cSld>'
	let intTableNum: number = 1

	// STEP 1: Add background
	if (slide.bkgd) {
		strSlideXml += genXmlColorSelection(false, slide.bkgd)
	}
	/* TODO: this is needed on slideMaster1.xml to avoid gray background in Finder
	// but it shoudln't go on every slide that comes along
	else {
		strSlideXml += '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'
	}*/

	// STEP 2: Add background image (using Strech) (if any)
	if (slide.bkgdImgRid) {
		// FIXME: We should be doing this in the slideLayout...
		strSlideXml +=
			'<p:bg>' +
			'<p:bgPr><a:blipFill dpi="0" rotWithShape="1">' +
			'<a:blip r:embed="rId' +
			slide.bkgdImgRid +
			'"><a:lum/></a:blip>' +
			'<a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>' +
			'<a:effectLst/></p:bgPr>' +
			'</p:bg>'
	}

	// STEP 3: Continue slide by starting spTree node
	strSlideXml += '<p:spTree>'
	strSlideXml += '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
	strSlideXml += '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
	strSlideXml += '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>'

	// STEP 4: Loop over all Slide.data objects and add them to this slide ===============================
	slide.data.forEach((slideItemObj: ISlideObject, idx: number) => {
		let x = 0,
			y = 0,
			cx = getSmartParseNumber('75%', 'X', slide.presLayout),
			cy = 0
		let placeholderObj: ISlideObject
		let locationAttr = '',
			shapeType = null

		if ((slide as ISlide).slideLayout !== undefined && (slide as ISlide).slideLayout.data !== undefined && slideItemObj.options && slideItemObj.options.placeholder) {
			placeholderObj = slide['slideLayout']['data'].filter((object: ISlideObject) => {
				return object.options.placeholder == slideItemObj.options.placeholder
			})[0]
		}

		// A: Set option vars
		slideItemObj.options = slideItemObj.options || {}

		if (slideItemObj.options.w || slideItemObj.options.w == 0) slideItemObj.options.cx = slideItemObj.options.w
		if (slideItemObj.options.h || slideItemObj.options.h == 0) slideItemObj.options.cy = slideItemObj.options.h
		//
		if (slideItemObj.options.x || slideItemObj.options.x == 0) x = getSmartParseNumber(slideItemObj.options.x, 'X', slide.presLayout)
		if (slideItemObj.options.y || slideItemObj.options.y == 0) y = getSmartParseNumber(slideItemObj.options.y, 'Y', slide.presLayout)
		if (slideItemObj.options.cx || slideItemObj.options.cx == 0) cx = getSmartParseNumber(slideItemObj.options.cx, 'X', slide.presLayout)
		if (slideItemObj.options.cy || slideItemObj.options.cy == 0) cy = getSmartParseNumber(slideItemObj.options.cy, 'Y', slide.presLayout)

		// If using a placeholder then inherit it's position
		if (placeholderObj) {
			if (placeholderObj.options.x || placeholderObj.options.x == 0) x = getSmartParseNumber(placeholderObj.options.x, 'X', slide.presLayout)
			if (placeholderObj.options.y || placeholderObj.options.y == 0) y = getSmartParseNumber(placeholderObj.options.y, 'Y', slide.presLayout)
			if (placeholderObj.options.cx || placeholderObj.options.cx == 0) cx = getSmartParseNumber(placeholderObj.options.cx, 'X', slide.presLayout)
			if (placeholderObj.options.cy || placeholderObj.options.cy == 0) cy = getSmartParseNumber(placeholderObj.options.cy, 'Y', slide.presLayout)
		}
		//
		if (slideItemObj.options.shape) shapeType = getShapeInfo(slideItemObj.options.shape)
		//
		if (slideItemObj.options.flipH) locationAttr += ' flipH="1"'
		if (slideItemObj.options.flipV) locationAttr += ' flipV="1"'
		if (slideItemObj.options.rotate) locationAttr += ' rot="' + convertRotationDegrees(slideItemObj.options.rotate) + '"'

		// B: Add OBJECT to current Slide ----------------------------
		switch (slideItemObj.type) {
			case SLIDE_OBJECT_TYPES.table:
				let objTableGrid = {}
				let arrTabRows = slideItemObj.arrTabRows
				let objTabOpts = slideItemObj.options
				let intColCnt = 0,
					intColW = 0
				let cellOpts: ITableCellOpts

				// Calc number of columns
				// NOTE: Cells may have a colspan, so merely taking the length of the [0] (or any other) row is not
				// ....: sufficient to determine column count. Therefore, check each cell for a colspan and total cols as reqd
				arrTabRows[0].forEach(cell => {
					cellOpts = cell.options || null
					intColCnt += cellOpts && cellOpts.colspan ? Number(cellOpts.colspan) : 1
				})

				// STEP 1: Start Table XML =============================
				// NOTE: Non-numeric cNvPr id values will trigger "presentation needs repair" type warning in MS-PPT-2013
				let strXml =
					'<p:graphicFrame>' +
					'  <p:nvGraphicFramePr>' +
					'    <p:cNvPr id="' +
					(intTableNum * slide.number + 1) +
					'" name="Table ' +
					intTableNum * slide.number +
					'"/>' +
					'    <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>' +
					'    <p:nvPr><p:extLst><p:ext uri="{D42A27DB-BD31-4B8C-83A1-F6EECF244321}"><p14:modId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1579011935"/></p:ext></p:extLst></p:nvPr>' +
					'  </p:nvGraphicFramePr>' +
					'  <p:xfrm>' +
					'    <a:off x="' +
					(x || (x == 0 ? 0 : EMU)) +
					'" y="' +
					(y || (y == 0 ? 0 : EMU)) +
					'"/>' +
					'    <a:ext cx="' +
					(cx || (cx == 0 ? 0 : EMU)) +
					'" cy="' +
					(cy || (cy == 0 ? 0 : EMU)) +
					'"/>' +
					'  </p:xfrm>' +
					'  <a:graphic>' +
					'    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">' +
					'      <a:tbl>' +
					'        <a:tblPr/>'
				// + '        <a:tblPr bandRow="1"/>';
				// FIXME: Support banded rows, first/last row, etc.
				// NOTE: Banding, etc. only shows when using a table style! (or set alt row color if banding)
				// <a:tblPr firstCol="0" firstRow="0" lastCol="0" lastRow="0" bandCol="0" bandRow="1">

				// STEP 2: Set column widths
				// Evenly distribute cols/rows across size provided when applicable (calc them if only overall dimensions were provided)
				// A: Col widths provided?
				if (Array.isArray(objTabOpts.colW)) {
					strXml += '<a:tblGrid>'
					for (var col = 0; col < intColCnt; col++) {
						strXml +=
							'<a:gridCol w="' +
							Math.round(inch2Emu(objTabOpts.colW[col]) || (typeof slideItemObj.options.cx === 'number' ? slideItemObj.options.cx : 1) / intColCnt) +
							'"/>'
					}
					strXml += '</a:tblGrid>'
				}
				// B: Table Width provided without colW? Then distribute cols
				else {
					intColW = objTabOpts.colW ? objTabOpts.colW : EMU
					if (slideItemObj.options.cx && !objTabOpts.colW)
						intColW = Math.round((typeof slideItemObj.options.cx === 'number' ? slideItemObj.options.cx : 1) / intColCnt)
					strXml += '<a:tblGrid>'
					for (var col = 0; col < intColCnt; col++) {
						strXml += '<a:gridCol w="' + intColW + '"/>'
					}
					strXml += '</a:tblGrid>'
				}

				// STEP 3: Build our row arrays into an actual grid to match the XML we will be building next (ISSUE #36)
				// Note row arrays can arrive "lopsided" as in row1:[1,2,3] row2:[3] when first two cols rowspan!,
				// so a simple loop below in XML building wont suffice to build table correctly.
				// We have to build an actual grid now
				/*
						EX: (A0:rowspan=3, B1:rowspan=2, C1:colspan=2)

						/------|------|------|------\
						|  A0  |  B0  |  C0  |  D0  |
						|      |  B1  |  C1  |      |
						|      |      |  C2  |  D2  |
						\------|------|------|------/
					*/
				arrTabRows.forEach((row, rIdx) => {
					// A: Create row if needed (recall one may be created in loop below for rowspans, so dont assume we need to create one each iteration)
					if (!objTableGrid[rIdx]) objTableGrid[rIdx] = {}

					// B: Loop over all cells
					row.forEach((cell, cIdx) => {
						// DESIGN: NOTE: Row cell arrays can be "uneven" (diff cell count in each) due to rowspan/colspan
						// Therefore, for each cell we run 0->colCount to determien the correct slot for it to reside
						// as the uneven/mixed nature of the data means we cannot use the cIdx value alone.
						// E.g.: the 2nd element in the row array may actually go into the 5th table grid row cell b/c of colspans!
						for (var idx = 0; cIdx + idx < intColCnt; idx++) {
							var currColIdx = cIdx + idx

							if (!objTableGrid[rIdx][currColIdx]) {
								// A: Set this cell
								objTableGrid[rIdx][currColIdx] = cell

								// B: Handle `colspan` or `rowspan` (a {cell} cant have both! FIXME: FUTURE: ROWSPAN & COLSPAN in same cell)
								if (cell && cell.options && cell.options.colspan && !isNaN(Number(cell.options.colspan))) {
									for (var idy = 1; idy < Number(cell.options.colspan); idy++) {
										objTableGrid[rIdx][currColIdx + idy] = { hmerge: true, text: 'hmerge' }
									}
								} else if (cell && cell.options && cell.options.rowspan && !isNaN(Number(cell.options.rowspan))) {
									for (var idz = 1; idz < Number(cell.options.rowspan); idz++) {
										if (!objTableGrid[rIdx + idz]) objTableGrid[rIdx + idz] = {}
										objTableGrid[rIdx + idz][currColIdx] = { vmerge: true, text: 'vmerge' }
									}
								}

								// C: Break out of colCnt loop now that slot has been filled
								break
							}
						}
					})
				})

				/* Only useful for rowspan/colspan testing
					if ( objTabOpts.debug ) {
						console.table(objTableGrid);
						var arrText = [];
						jQuery.each(objTableGrid, function(i,row){ var arrRow = []; jQuery.each(row,function(i,cell){ arrRow.push(cell.text); }); arrText.push(arrRow); });
						console.table( arrText );
					}
					*/

				// STEP 4: Build table rows/cells ============================
				jQuery.each(objTableGrid, (rIdx, rowObj) => {
					// A: Table Height provided without rowH? Then distribute rows
					var intRowH = 0 // IMPORTANT: Default must be zero for auto-sizing to work
					if (Array.isArray(objTabOpts.rowH) && objTabOpts.rowH[rIdx]) intRowH = inch2Emu(Number(objTabOpts.rowH[rIdx]))
					else if (objTabOpts.rowH && !isNaN(Number(objTabOpts.rowH))) intRowH = inch2Emu(Number(objTabOpts.rowH))
					else if (slideItemObj.options.cy || slideItemObj.options.h)
						intRowH =
							(slideItemObj.options.h ? inch2Emu(slideItemObj.options.h) : typeof slideItemObj.options.cy === 'number' ? slideItemObj.options.cy : 1) /
							arrTabRows.length

					// B: Start row
					strXml += '<a:tr h="' + intRowH + '">'

					// C: Loop over each CELL
					jQuery.each(rowObj, (_cIdx, cell: ITableCell) => {
						// 1: "hmerge" cells are just place-holders in the table grid - skip those and go to next cell
						if (cell.hmerge) return

						// 2: OPTIONS: Build/set cell options ===========================

						let cellOpts = cell.options || ({} as ITableCell['options'])
						/// TODO-3: FIXME: ONLY MAKE CELLS with objects! if (typeof cell === 'number' || typeof cell === 'string') cell = { text: cell.toString() }
						cellOpts.isTableCell = true // Used to create textBody XML
						cell.options = cellOpts

						// B: Apply default values (tabOpts being used when cellOpts dont exist):
						// SEE: http://officeopenxml.com/drwTableCellProperties-alignment.php
						;['align', 'bold', 'border', 'color', 'fill', 'fontFace', 'fontSize', 'margin', 'underline', 'valign'].forEach(name => {
							if (objTabOpts[name] && !cellOpts[name] && cellOpts[name] != 0) cellOpts[name] = objTabOpts[name]
						})

						let cellValign = cellOpts.valign
							? ' anchor="' +
							  cellOpts.valign
									.replace(/^c$/i, 'ctr')
									.replace(/^m$/i, 'ctr')
									.replace('center', 'ctr')
									.replace('middle', 'ctr')
									.replace('top', 't')
									.replace('btm', 'b')
									.replace('bottom', 'b') +
							  '"'
							: ''
						let cellColspan = cellOpts.colspan ? ' gridSpan="' + cellOpts.colspan + '"' : ''
						let cellRowspan = cellOpts.rowspan ? ' rowSpan="' + cellOpts.rowspan + '"' : ''
						let cellFill =
							(cell.optImp && cell.optImp.fill) || cellOpts.fill
								? ' <a:solidFill><a:srgbClr val="' + ((cell.optImp && cell.optImp.fill) || cellOpts.fill.replace('#', '')) + '"/></a:solidFill>'
								: ''
						let cellMargin = cellOpts.margin == 0 || cellOpts.margin ? cellOpts.margin : DEF_CELL_MARGIN_PT
						if (!Array.isArray(cellMargin) && typeof cellMargin === 'number') cellMargin = [cellMargin, cellMargin, cellMargin, cellMargin]
						let cellMarginXml =
							' marL="' +
							cellMargin[3] * ONEPT +
							'" marR="' +
							cellMargin[1] * ONEPT +
							'" marT="' +
							cellMargin[0] * ONEPT +
							'" marB="' +
							cellMargin[2] * ONEPT +
							'"'

						// FIXME: Cell NOWRAP property (text wrap: add to a:tcPr (horzOverflow="overflow" or whatev options exist)

						// 3: ROWSPAN: Add dummy cells for any active rowspan
						if (cell.vmerge) {
							strXml += '<a:tc vMerge="1"><a:tcPr/></a:tc>'
							return
						}

						// 4: Set CELL content and properties ==================================
						strXml += '<a:tc' + cellColspan + cellRowspan + '>' + genXmlTextBody(cell) + '<a:tcPr' + cellMarginXml + cellValign + '>'

						// 5: Borders: Add any borders
						/// TODO=3: FIXME: stop using `none` if (cellOpts.border && typeof cellOpts.border === 'string' && cellOpts.border.toLowerCase() == 'none') {
						if (cellOpts.border && cellOpts.border.type == 'none') {
							strXml += '  <a:lnL w="0" cap="flat" cmpd="sng" algn="ctr"><a:noFill/></a:lnL>'
							strXml += '  <a:lnR w="0" cap="flat" cmpd="sng" algn="ctr"><a:noFill/></a:lnR>'
							strXml += '  <a:lnT w="0" cap="flat" cmpd="sng" algn="ctr"><a:noFill/></a:lnT>'
							strXml += '  <a:lnB w="0" cap="flat" cmpd="sng" algn="ctr"><a:noFill/></a:lnB>'
						} else if (cellOpts.border && typeof cellOpts.border === 'string') {
							strXml +=
								'  <a:lnL w="' + ONEPT + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="' + cellOpts.border + '"/></a:solidFill></a:lnL>'
							strXml +=
								'  <a:lnR w="' + ONEPT + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="' + cellOpts.border + '"/></a:solidFill></a:lnR>'
							strXml +=
								'  <a:lnT w="' + ONEPT + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="' + cellOpts.border + '"/></a:solidFill></a:lnT>'
							strXml +=
								'  <a:lnB w="' + ONEPT + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:srgbClr val="' + cellOpts.border + '"/></a:solidFill></a:lnB>'
						} else if (cellOpts.border && Array.isArray(cellOpts.border)) {
							jQuery.each([{ idx: 3, name: 'lnL' }, { idx: 1, name: 'lnR' }, { idx: 0, name: 'lnT' }, { idx: 2, name: 'lnB' }], (_i, obj) => {
								if (cellOpts.border[obj.idx]) {
									var strC =
										'<a:solidFill><a:srgbClr val="' +
										(cellOpts.border[obj.idx].color ? cellOpts.border[obj.idx].color : DEF_CELL_BORDER.color) +
										'"/></a:solidFill>'
									var intW =
										cellOpts.border[obj.idx] && (cellOpts.border[obj.idx].pt || cellOpts.border[obj.idx].pt == 0)
											? ONEPT * Number(cellOpts.border[obj.idx].pt)
											: ONEPT
									strXml += '<a:' + obj.name + ' w="' + intW + '" cap="flat" cmpd="sng" algn="ctr">' + strC + '</a:' + obj.name + '>'
								} else strXml += '<a:' + obj.name + ' w="0"><a:miter lim="400000"/></a:' + obj.name + '>'
							})
						} else if (cellOpts.border && typeof cellOpts.border === 'object') {
							var intW = cellOpts.border && (cellOpts.border.pt || cellOpts.border.pt == 0) ? ONEPT * Number(cellOpts.border.pt) : ONEPT
							var strClr =
								'<a:solidFill><a:srgbClr val="' +
								(cellOpts.border.color ? cellOpts.border.color.replace('#', '') : DEF_CELL_BORDER.color) +
								'"/></a:solidFill>'
							var strAttr = '<a:prstDash val="'
							strAttr += cellOpts.border.type && cellOpts.border.type.toLowerCase().indexOf('dash') > -1 ? 'sysDash' : 'solid'
							strAttr += '"/><a:round/><a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/>'
							// *** IMPORTANT! *** LRTB order matters! (Reorder a line below to watch the borders go wonky in MS-PPT-2013!!)
							strXml += '<a:lnL w="' + intW + '" cap="flat" cmpd="sng" algn="ctr">' + strClr + strAttr + '</a:lnL>'
							strXml += '<a:lnR w="' + intW + '" cap="flat" cmpd="sng" algn="ctr">' + strClr + strAttr + '</a:lnR>'
							strXml += '<a:lnT w="' + intW + '" cap="flat" cmpd="sng" algn="ctr">' + strClr + strAttr + '</a:lnT>'
							strXml += '<a:lnB w="' + intW + '" cap="flat" cmpd="sng" algn="ctr">' + strClr + strAttr + '</a:lnB>'
							// *** IMPORTANT! *** LRTB order matters!
						}

						// 6: Close cell Properties & Cell
						strXml += cellFill
						strXml += '  </a:tcPr>'
						strXml += ' </a:tc>'

						// LAST: COLSPAN: Add a 'merged' col for each column being merged (SEE: http://officeopenxml.com/drwTableGrid.php)
						if (cellOpts.colspan) {
							for (var tmp = 1; tmp < Number(cellOpts.colspan); tmp++) {
								strXml += '<a:tc hMerge="1"><a:tcPr/></a:tc>'
							}
						}
					})

					// D: Complete row
					strXml += '</a:tr>'
				})

				// STEP 5: Complete table
				strXml += '      </a:tbl>'
				strXml += '    </a:graphicData>'
				strXml += '  </a:graphic>'
				strXml += '</p:graphicFrame>'

				// STEP 6: Set table XML
				strSlideXml += strXml

				// LAST: Increment counter
				intTableNum++
				break

			case SLIDE_OBJECT_TYPES.text:
			case SLIDE_OBJECT_TYPES.placeholder:
				// Lines can have zero cy, but text should not
				if (!slideItemObj.options.line && cy == 0) cy = EMU * 0.3

				// Margin/Padding/Inset for textboxes
				if (slideItemObj.options.margin && Array.isArray(slideItemObj.options.margin)) {
					slideItemObj.options.bodyProp.lIns = slideItemObj.options.margin[0] * ONEPT || 0
					slideItemObj.options.bodyProp.rIns = slideItemObj.options.margin[1] * ONEPT || 0
					slideItemObj.options.bodyProp.bIns = slideItemObj.options.margin[2] * ONEPT || 0
					slideItemObj.options.bodyProp.tIns = slideItemObj.options.margin[3] * ONEPT || 0
				} else if ((slideItemObj.options.margin || slideItemObj.options.margin == 0) && !isNaN(slideItemObj.options.margin)) {
					slideItemObj.options.bodyProp.lIns = slideItemObj.options.margin * ONEPT
					slideItemObj.options.bodyProp.rIns = slideItemObj.options.margin * ONEPT
					slideItemObj.options.bodyProp.bIns = slideItemObj.options.margin * ONEPT
					slideItemObj.options.bodyProp.tIns = slideItemObj.options.margin * ONEPT
				}

				if (shapeType == null) shapeType = getShapeInfo(null)

				// A: Start SHAPE =======================================================
				strSlideXml += '<p:sp>'

				// B: The addition of the "txBox" attribute is the sole determiner of if an object is a Shape or Textbox
				strSlideXml += '<p:nvSpPr><p:cNvPr id="' + (idx + 2) + '" name="Object ' + (idx + 1) + '"/>'
				strSlideXml += '<p:cNvSpPr' + (slideItemObj.options && slideItemObj.options.isTextBox ? ' txBox="1"/>' : '/>')
				strSlideXml += '<p:nvPr>'
				strSlideXml += slideItemObj.type === 'placeholder' ? genXmlPlaceholder(slideItemObj) : genXmlPlaceholder(placeholderObj)
				strSlideXml += '</p:nvPr>'
				strSlideXml += '</p:nvSpPr><p:spPr>'
				strSlideXml += '<a:xfrm' + locationAttr + '>'
				strSlideXml += '<a:off x="' + x + '" y="' + y + '"/>'
				strSlideXml += '<a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>'
				strSlideXml +=
					'<a:prstGeom prst="' +
					shapeType.name +
					'"><a:avLst>' +
					(slideItemObj.options.rectRadius
						? '<a:gd name="adj" fmla="val ' + Math.round((slideItemObj.options.rectRadius * EMU * 100000) / Math.min(cx, cy)) + '"/>'
						: '') +
					'</a:avLst></a:prstGeom>'

				// Option: FILL
				strSlideXml += slideItemObj.options.fill ? genXmlColorSelection(slideItemObj.options.fill) : '<a:noFill/>'

				// Shape Type: LINE: line color
				if (slideItemObj.options.line) {
					strSlideXml += '<a:ln' + (slideItemObj.options.lineSize ? ' w="' + slideItemObj.options.lineSize * ONEPT + '"' : '') + '>'
					strSlideXml += genXmlColorSelection(slideItemObj.options.line)
					if (slideItemObj.options.lineDash) strSlideXml += '<a:prstDash val="' + slideItemObj.options.lineDash + '"/>'
					if (slideItemObj.options.lineHead) strSlideXml += '<a:headEnd type="' + slideItemObj.options.lineHead + '"/>'
					if (slideItemObj.options.lineTail) strSlideXml += '<a:tailEnd type="' + slideItemObj.options.lineTail + '"/>'
					strSlideXml += '</a:ln>'
				}

				// EFFECTS > SHADOW: REF: @see http://officeopenxml.com/drwSp-effects.php
				if (slideItemObj.options.shadow) {
					slideItemObj.options.shadow.type = slideItemObj.options.shadow.type || 'outer'
					slideItemObj.options.shadow.blur = (slideItemObj.options.shadow.blur || 8) * ONEPT
					slideItemObj.options.shadow.offset = (slideItemObj.options.shadow.offset || 4) * ONEPT
					slideItemObj.options.shadow.angle = (slideItemObj.options.shadow.angle || 270) * 60000
					slideItemObj.options.shadow.color = slideItemObj.options.shadow.color || '000000'
					slideItemObj.options.shadow.opacity = (slideItemObj.options.shadow.opacity || 0.75) * 100000

					strSlideXml += '<a:effectLst>'
					strSlideXml += '<a:' + slideItemObj.options.shadow.type + 'Shdw sx="100000" sy="100000" kx="0" ky="0" '
					strSlideXml += ' algn="bl" rotWithShape="0" blurRad="' + slideItemObj.options.shadow.blur + '" '
					strSlideXml += ' dist="' + slideItemObj.options.shadow.offset + '" dir="' + slideItemObj.options.shadow.angle + '">'
					strSlideXml += '<a:srgbClr val="' + slideItemObj.options.shadow.color + '">'
					strSlideXml += '<a:alpha val="' + slideItemObj.options.shadow.opacity + '"/></a:srgbClr>'
					strSlideXml += '</a:outerShdw>'
					strSlideXml += '</a:effectLst>'
				}

				/* FIXME: FUTURE: Text wrapping (copied from MS-PPTX export)
					// Commented out b/c i'm not even sure this works - current code produces text that wraps in shapes and textboxes, so...
					if ( slideItemObj.options.textWrap ) {
						strSlideXml += '<a:extLst>'
									+ '<a:ext uri="{C572A759-6A51-4108-AA02-DFA0A04FC94B}">'
									+ '<ma14:wrappingTextBoxFlag xmlns:ma14="http://schemas.microsoft.com/office/mac/drawingml/2011/main" val="1"/>'
									+ '</a:ext>'
									+ '</a:extLst>';
					}
					*/

				// B: Close Shape Properties
				strSlideXml += '</p:spPr>'

				// C: Add formatted text (text body "bodyPr")
				strSlideXml += genXmlTextBody(slideItemObj)

				// LAST: Close SHAPE =======================================================
				strSlideXml += '</p:sp>'
				break

			case SLIDE_OBJECT_TYPES.image:
				var sizing = slideItemObj.options.sizing,
					rounding = slideItemObj.options.rounding,
					width = cx,
					height = cy

				strSlideXml += '<p:pic>'
				strSlideXml += '  <p:nvPicPr>'
				strSlideXml += '    <p:cNvPr id="' + (idx + 2) + '" name="Object ' + (idx + 1) + '" descr="' + encodeXmlEntities(slideItemObj.image) + '">'
				if (slideItemObj.hyperlink && slideItemObj.hyperlink.url)
					strSlideXml +=
						'<a:hlinkClick r:id="rId' +
						slideItemObj.hyperlink.rId +
						'" tooltip="' +
						(slideItemObj.hyperlink.tooltip ? encodeXmlEntities(slideItemObj.hyperlink.tooltip) : '') +
						'"/>'
				if (slideItemObj.hyperlink && slideItemObj.hyperlink.slide)
					strSlideXml +=
						'<a:hlinkClick r:id="rId' +
						slideItemObj.hyperlink.rId +
						'" tooltip="' +
						(slideItemObj.hyperlink.tooltip ? encodeXmlEntities(slideItemObj.hyperlink.tooltip) : '') +
						'" action="ppaction://hlinksldjump"/>'
				strSlideXml += '    </p:cNvPr>'
				strSlideXml += '    <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
				strSlideXml += '    <p:nvPr>' + genXmlPlaceholder(placeholderObj) + '</p:nvPr>'
				strSlideXml += '  </p:nvPicPr>'
				strSlideXml += '<p:blipFill>'
				// NOTE: This works for both cases: either `path` or `data` contains the SVG
				if (
					(slide['relsMedia'] || []).filter(rel => {
						return rel.rId == slideItemObj.imageRid
					})[0] &&
					(slide['relsMedia'] || []).filter(rel => {
						return rel.rId == slideItemObj.imageRid
					})[0]['extn'] == 'svg'
				) {
					strSlideXml += '<a:blip r:embed="rId' + (slideItemObj.imageRid - 1) + '"/>'
					strSlideXml += '<a:extLst>'
					strSlideXml += '  <a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">'
					strSlideXml += '    <asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId' + slideItemObj.imageRid + '"/>'
					strSlideXml += '  </a:ext>'
					strSlideXml += '</a:extLst>'
				} else {
					strSlideXml += '<a:blip r:embed="rId' + slideItemObj.imageRid + '"/>'
				}
				if (sizing && sizing.type) {
					var boxW = sizing.w ? getSmartParseNumber(sizing.w, 'X', slide.presLayout) : cx,
						boxH = sizing.h ? getSmartParseNumber(sizing.h, 'Y', slide.presLayout) : cy,
						boxX = getSmartParseNumber(sizing.x || 0, 'X', slide.presLayout),
						boxY = getSmartParseNumber(sizing.y || 0, 'Y', slide.presLayout)

					strSlideXml += imageSizingXml[sizing.type]({ w: width, h: height }, { w: boxW, h: boxH, x: boxX, y: boxY })
					width = boxW
					height = boxH
				} else {
					strSlideXml += '  <a:stretch><a:fillRect/></a:stretch>'
				}
				strSlideXml += '</p:blipFill>'
				strSlideXml += '<p:spPr>'
				strSlideXml += ' <a:xfrm' + locationAttr + '>'
				strSlideXml += '  <a:off x="' + x + '" y="' + y + '"/>'
				strSlideXml += '  <a:ext cx="' + width + '" cy="' + height + '"/>'
				strSlideXml += ' </a:xfrm>'
				strSlideXml += ' <a:prstGeom prst="' + (rounding ? 'ellipse' : 'rect') + '"><a:avLst/></a:prstGeom>'
				strSlideXml += '</p:spPr>'
				strSlideXml += '</p:pic>'
				break

			case SLIDE_OBJECT_TYPES.media:
				if (slideItemObj.mtype == 'online') {
					strSlideXml += '<p:pic>'
					strSlideXml += ' <p:nvPicPr>'
					// IMPORTANT: <p:cNvPr id="" value is critical - if not the same number as preview image rId, PowerPoint throws error!
					strSlideXml += ' <p:cNvPr id="' + (slideItemObj.mediaRid + 2) + '" name="Picture' + (idx + 1) + '"/>'
					strSlideXml += ' <p:cNvPicPr/>'
					strSlideXml += ' <p:nvPr>'
					strSlideXml += '  <a:videoFile r:link="rId' + slideItemObj.mediaRid + '"/>'
					strSlideXml += ' </p:nvPr>'
					strSlideXml += ' </p:nvPicPr>'
					// NOTE: `blip` is diferent than videos; also there's no preview "p:extLst" above but exists in videos
					strSlideXml += ' <p:blipFill><a:blip r:embed="rId' + (slideItemObj.mediaRid + 1) + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' // NOTE: Preview image is required!
					strSlideXml += ' <p:spPr>'
					strSlideXml += '  <a:xfrm' + locationAttr + '>'
					strSlideXml += '   <a:off x="' + x + '" y="' + y + '"/>'
					strSlideXml += '   <a:ext cx="' + cx + '" cy="' + cy + '"/>'
					strSlideXml += '  </a:xfrm>'
					strSlideXml += '  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
					strSlideXml += ' </p:spPr>'
					strSlideXml += '</p:pic>'
				} else {
					strSlideXml += '<p:pic>'
					strSlideXml += ' <p:nvPicPr>'
					// IMPORTANT: <p:cNvPr id="" value is critical - if not the same number as preiew image rId, PowerPoint throws error!
					strSlideXml +=
						' <p:cNvPr id="' +
						(slideItemObj.mediaRid + 2) +
						'" name="' +
						slideItemObj.media
							.split('/')
							.pop()
							.split('.')
							.shift() +
						'"><a:hlinkClick r:id="" action="ppaction://media"/></p:cNvPr>'
					strSlideXml += ' <p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>'
					strSlideXml += ' <p:nvPr>'
					strSlideXml += '  <a:videoFile r:link="rId' + slideItemObj.mediaRid + '"/>'
					strSlideXml += '  <p:extLst>'
					strSlideXml += '   <p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}">'
					strSlideXml += '    <p14:media xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" r:embed="rId' + (slideItemObj.mediaRid + 1) + '"/>'
					strSlideXml += '   </p:ext>'
					strSlideXml += '  </p:extLst>'
					strSlideXml += ' </p:nvPr>'
					strSlideXml += ' </p:nvPicPr>'
					strSlideXml += ' <p:blipFill><a:blip r:embed="rId' + (slideItemObj.mediaRid + 2) + '"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' // NOTE: Preview image is required!
					strSlideXml += ' <p:spPr>'
					strSlideXml += '  <a:xfrm' + locationAttr + '>'
					strSlideXml += '   <a:off x="' + x + '" y="' + y + '"/>'
					strSlideXml += '   <a:ext cx="' + cx + '" cy="' + cy + '"/>'
					strSlideXml += '  </a:xfrm>'
					strSlideXml += '  <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
					strSlideXml += ' </p:spPr>'
					strSlideXml += '</p:pic>'
				}
				break

			case SLIDE_OBJECT_TYPES.chart:
				strSlideXml += '<p:graphicFrame>'
				strSlideXml += ' <p:nvGraphicFramePr>'
				strSlideXml += '   <p:cNvPr id="' + (idx + 2) + '" name="Chart ' + (idx + 1) + '"/>'
				strSlideXml += '   <p:cNvGraphicFramePr/>'
				strSlideXml += '   <p:nvPr>' + genXmlPlaceholder(placeholderObj) + '</p:nvPr>'
				strSlideXml += ' </p:nvGraphicFramePr>'
				strSlideXml += ' <p:xfrm>'
				strSlideXml += '  <a:off x="' + x + '" y="' + y + '"/>'
				strSlideXml += '  <a:ext cx="' + cx + '" cy="' + cy + '"/>'
				strSlideXml += ' </p:xfrm>'
				strSlideXml += ' <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
				strSlideXml += '  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">'
				strSlideXml += '   <c:chart r:id="rId' + slideItemObj.chartRid + '" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>'
				strSlideXml += '  </a:graphicData>'
				strSlideXml += ' </a:graphic>'
				strSlideXml += '</p:graphicFrame>'
				break
		}
	})

	// STEP 5: Add slide numbers last (if any)
	if (slide.slideNumberObj) {
		// FIXME: slide numbers not working
		console.log('FIXME: slideNumberObj')
		console.log(slide)
		strSlideXml +=
			'<p:sp>' +
			'  <p:nvSpPr>' +
			'    <p:cNvPr id="25" name="Slide Number Placeholder 24"/>' +
			'    <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' +
			'    <p:nvPr><p:ph type="sldNum" sz="quarter" idx="4294967295"/></p:nvPr>' +
			'  </p:nvSpPr>' +
			'  <p:spPr>' +
			'    <a:xfrm>' +
			'      <a:off x="' +
			getSmartParseNumber(slide.slideNumberObj.x, 'X', slide.presLayout) +
			'" y="' +
			getSmartParseNumber(slide.slideNumberObj.y, 'Y', slide.presLayout) +
			'"/>' +
			'      <a:ext cx="' +
			(slide.slideNumberObj.w ? getSmartParseNumber(slide.slideNumberObj.w, 'X', slide.presLayout) : 800000) +
			'" cy="' +
			(slide.slideNumberObj.h ? getSmartParseNumber(slide.slideNumberObj.h, 'Y', slide.presLayout) : 300000) +
			'"/>' +
			'    </a:xfrm>' +
			'    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
			'    <a:extLst><a:ext uri="{C572A759-6A51-4108-AA02-DFA0A04FC94B}"><ma14:wrappingTextBoxFlag val="0" xmlns:ma14="http://schemas.microsoft.com/office/mac/drawingml/2011/main"/></a:ext></a:extLst>' +
			'  </p:spPr>'
		// ISSUE #68: "Page number styling"
		strSlideXml += '<p:txBody>'
		strSlideXml += '  <a:bodyPr/>'
		strSlideXml += '  <a:lstStyle><a:lvl1pPr>'
		if (slide.slideNumberObj.fontFace || slide.slideNumberObj.fontSize || slide.slideNumberObj.color) {
			strSlideXml += '<a:defRPr sz="' + (slide.slideNumberObj.fontSize ? Math.round(slide.slideNumberObj.fontSize) : '12') + '00">'
			if (slide.slideNumberObj.color) strSlideXml += genXmlColorSelection(slide.slideNumberObj.color)
			if (slide.slideNumberObj.fontFace)
				strSlideXml +=
					'<a:latin typeface="' +
					slide.slideNumberObj.fontFace +
					'"/><a:ea typeface="' +
					slide.slideNumberObj.fontFace +
					'"/><a:cs typeface="' +
					slide.slideNumberObj.fontFace +
					'"/>'
			strSlideXml += '</a:defRPr>'
		}
		strSlideXml += '</a:lvl1pPr></a:lstStyle>'
		strSlideXml += '<a:p><a:fld id="' + SLDNUMFLDID + '" type="slidenum">' + '<a:rPr lang="en-US" smtClean="0"/><a:t></a:t></a:fld>' + '<a:endParaRPr lang="en-US"/></a:p>'
		strSlideXml += '</p:txBody></p:sp>'
	}

	// STEP 6: Close spTree and finalize slide XML
	strSlideXml += '</p:spTree>'
	strSlideXml += '</p:cSld>'

	// LAST: Return
	return strSlideXml
}

/**
 * Transforms slide relations to XML string.
 * Extra relations that are not dynamic can be passed using the 2nd arg (e.g. theme relation in master file).
 * These relations use rId series that starts with 1-increased maximum of rIds used for dynamic relations.
 *
 * @param {ISlide | ISlideLayout} `slideObject` slide object whose relations are being transformed
 * @param {{ target: string; type: string }[]} `defaultRels` array of default relations
 * @return {string} XML
 */
function slideObjectRelationsToXml(slideObject: ISlide | ISlideLayout, defaultRels: { target: string; type: string }[]): string {
	let lastRid = 0 // stores maximum rId used for dynamic relations
	let strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'

	// Add all rels for this Slide
	slideObject.rels.forEach((rel: ISlideRel) => {
		lastRid = Math.max(lastRid, rel.rId)
		if (rel.type.toLowerCase().indexOf('hyperlink') > -1) {
			if (rel.data == 'slide') {
				strXml +=
					'<Relationship Id="rId' +
					rel.rId +
					'" Target="slide' +
					rel.Target +
					'.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"/>'
			} else {
				strXml +=
					'<Relationship Id="rId' +
					rel.rId +
					'" Target="' +
					rel.Target +
					'" TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"/>'
			}
		} else if (rel.type.toLowerCase().indexOf('notesSlide') > -1) {
			strXml +=
				'<Relationship Id="rId' + rel.rId + '" Target="' + rel.Target + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide"/>'
		}
	})
	;(slideObject.relsChart || []).forEach((rel: ISlideRelChart) => {
		lastRid = Math.max(lastRid, rel.rId)
		strXml += '<Relationship Id="rId' + rel.rId + '" Target="' + rel.Target + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart"/>'
	})
	;(slideObject.relsMedia || []).forEach((rel: ISlideRelMedia) => {
		if (rel.type.toLowerCase().indexOf('image') > -1) {
			strXml += '<Relationship Id="rId' + rel.rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + rel.Target + '"/>'
		} else if (rel.type.toLowerCase().indexOf('audio') > -1) {
			// As media has *TWO* rel entries per item, check for first one, if found add second rel with alt style
			if (strXml.indexOf(' Target="' + rel.Target + '"') > -1)
				strXml += '<Relationship Id="rId' + rel.rId + '" Type="http://schemas.microsoft.com/office/2007/relationships/media" Target="' + rel.Target + '"/>'
			else
				strXml +=
					'<Relationship Id="rId' + rel.rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/audio" Target="' + rel.Target + '"/>'
		} else if (rel.type.toLowerCase().indexOf('video') > -1) {
			// As media has *TWO* rel entries per item, check for first one, if found add second rel with alt style
			if (strXml.indexOf(' Target="' + rel.Target + '"') > -1)
				strXml += '<Relationship Id="rId' + rel.rId + '" Type="http://schemas.microsoft.com/office/2007/relationships/media" Target="' + rel.Target + '"/>'
			else
				strXml +=
					'<Relationship Id="rId' + rel.rId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="' + rel.Target + '"/>'
		} else if (rel.type.toLowerCase().indexOf('online') > -1) {
			// As media has *TWO* rel entries per item, check for first one, if found add second rel with alt style
			if (strXml.indexOf(' Target="' + rel.Target + '"') > -1)
				strXml += '<Relationship Id="rId' + rel.rId + '" Type="http://schemas.microsoft.com/office/2007/relationships/image" Target="' + rel.Target + '"/>'
			else
				strXml +=
					'<Relationship Id="rId' +
					rel.rId +
					'" Target="' +
					rel.Target +
					'" TargetMode="External" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video"/>'
		}
	})

	defaultRels.forEach((rel, idx) => {
		strXml += '<Relationship Id="rId' + (lastRid + idx + 1) + '" Type="' + rel.type + '" Target="' + rel.target + '"/>'
	})

	strXml += '</Relationships>'
	return strXml
}

/**
 * Magic happens here
 */
function parseTextToLines(cell: ITableCell, inWidth: number): Array<string> {
	let CHAR = 2.2 + (cell.options && cell.options.lineWeight ? cell.options.lineWeight : 0) // Character Constant (An approximation of the Golden Ratio)
	let CPL = (inWidth * EMU) / ((cell.options && cell.options.fontSize || DEF_FONT_SIZE) / CHAR) // Chars-Per-Line
	let arrLines = []
	let strCurrLine = ''

	// Allow a single space/whitespace as cell text
	if (cell.text && cell.text.toString().trim() == '') return [' ']

	// A: Remove leading/trailing space
	var inStr = (cell.text || '').toString().trim()

	// B: Build line array
	jQuery.each(inStr.split('\n'), (_idx, line) => {
		jQuery.each(line.split(' '), (_idx, word) => {
			if (strCurrLine.length + word.length + 1 < CPL) {
				strCurrLine += word + ' '
			} else {
				if (strCurrLine) arrLines.push(strCurrLine)
				strCurrLine = word + ' '
			}
		})
		// All words for this line have been exhausted, flush buffer to new line, clear line var
		if (strCurrLine) arrLines.push(jQuery.trim(strCurrLine) + CRLF)
		strCurrLine = ''
	})

	// C: Remove trailing linebreak
	arrLines[arrLines.length - 1] = jQuery.trim(arrLines[arrLines.length - 1])

	// D: Return lines
	return arrLines
}

function genXmlParagraphProperties(textObj, isDefault) {
	var strXmlBullet = '',
		strXmlLnSpc = '',
		strXmlParaSpc = '',
		paraPropXmlCore = ''
	var bulletLvl0Margin = 342900
	var tag = isDefault ? 'a:lvl1pPr' : 'a:pPr'

	var paragraphPropXml = '<' + tag + (textObj.options.rtlMode ? ' rtl="1" ' : '')

	// A: Build paragraphProperties
	{
		// OPTION: align
		if (textObj.options.align) {
			switch (textObj.options.align) {
				case 'l':
				case 'left':
					paragraphPropXml += ' algn="l"'
					break
				case 'r':
				case 'right':
					paragraphPropXml += ' algn="r"'
					break
				case 'c':
				case 'ctr':
				case 'center':
					paragraphPropXml += ' algn="ctr"'
					break
				case 'justify':
					paragraphPropXml += ' algn="just"'
					break
			}
		}

		if (textObj.options.lineSpacing) {
			strXmlLnSpc = '<a:lnSpc><a:spcPts val="' + textObj.options.lineSpacing + '00"/></a:lnSpc>'
		}

		// OPTION: indent
		if (textObj.options.indentLevel && !isNaN(Number(textObj.options.indentLevel)) && textObj.options.indentLevel > 0) {
			paragraphPropXml += ' lvl="' + textObj.options.indentLevel + '"'
		}

		// OPTION: Paragraph Spacing: Before/After
		if (textObj.options.paraSpaceBefore && !isNaN(Number(textObj.options.paraSpaceBefore)) && textObj.options.paraSpaceBefore > 0) {
			strXmlParaSpc += '<a:spcBef><a:spcPts val="' + textObj.options.paraSpaceBefore * 100 + '"/></a:spcBef>'
		}
		if (textObj.options.paraSpaceAfter && !isNaN(Number(textObj.options.paraSpaceAfter)) && textObj.options.paraSpaceAfter > 0) {
			strXmlParaSpc += '<a:spcAft><a:spcPts val="' + textObj.options.paraSpaceAfter * 100 + '"/></a:spcAft>'
		}

		// Set core XML for use below
		paraPropXmlCore = paragraphPropXml

		// OPTION: bullet
		// NOTE: OOXML uses the unicode character set for Bullets
		// EX: Unicode Character 'BULLET' (U+2022) ==> '<a:buChar char="&#x2022;"/>'
		if (typeof textObj.options.bullet === 'object') {
			if (textObj.options.bullet.type) {
				if (textObj.options.bullet.type.toString().toLowerCase() == 'number') {
					paragraphPropXml +=
						' marL="' +
						(textObj.options.indentLevel && textObj.options.indentLevel > 0
							? bulletLvl0Margin + bulletLvl0Margin * textObj.options.indentLevel
							: bulletLvl0Margin) +
						'" indent="-' +
						bulletLvl0Margin +
						'"'
					strXmlBullet = '<a:buSzPct val="100000"/><a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>'
				}
			} else if (textObj.options.bullet.code) {
				var bulletCode = '&#x' + textObj.options.bullet.code + ';'

				// Check value for hex-ness (s/b 4 char hex)
				if (/^[0-9A-Fa-f]{4}$/.test(textObj.options.bullet.code) == false) {
					console.warn('Warning: `bullet.code should be a 4-digit hex code (ex: 22AB)`!')
					bulletCode = BULLET_TYPES['DEFAULT']
				}

				paragraphPropXml +=
					' marL="' +
					(textObj.options.indentLevel && textObj.options.indentLevel > 0 ? bulletLvl0Margin + bulletLvl0Margin * textObj.options.indentLevel : bulletLvl0Margin) +
					'" indent="-' +
					bulletLvl0Margin +
					'"'
				strXmlBullet = '<a:buSzPct val="100000"/><a:buChar char="' + bulletCode + '"/>'
			}
		} else if (textObj.options.bullet == true) {
			paragraphPropXml +=
				' marL="' +
				(textObj.options.indentLevel && textObj.options.indentLevel > 0 ? bulletLvl0Margin + bulletLvl0Margin * textObj.options.indentLevel : bulletLvl0Margin) +
				'" indent="-' +
				bulletLvl0Margin +
				'"'
			strXmlBullet = '<a:buSzPct val="100000"/><a:buChar char="' + BULLET_TYPES['DEFAULT'] + '"/>'
		} else {
			strXmlBullet = '<a:buNone/>'
		}

		// Close Paragraph-Properties --------------------
		// IMPORTANT: strXmlLnSpc, strXmlParaSpc, and strXmlBullet require strict ordering.
		//            anything out of order is ignored. (PPT-Online, PPT for Mac)
		paragraphPropXml += '>' + strXmlLnSpc + strXmlParaSpc + strXmlBullet
		if (isDefault) {
			paragraphPropXml += genXmlTextRunProperties(textObj.options, true)
		}
		paragraphPropXml += '</' + tag + '>'
	}

	return paragraphPropXml
}

function genXmlTextRunProperties(opts, isDefault) {
	var runProps = ''
	var runPropsTag = isDefault ? 'a:defRPr' : 'a:rPr'

	// BEGIN runProperties
	runProps += '<' + runPropsTag + ' lang="' + (opts.lang ? opts.lang : 'en-US') + '" ' + (opts.lang ? ' altLang="en-US"' : '')
	runProps += opts.bold ? ' b="1"' : ''
	runProps += opts.fontSize ? ' sz="' + Math.round(opts.fontSize) + '00"' : '' // NOTE: Use round so sizes like '7.5' wont cause corrupt pres.
	runProps += opts.italic ? ' i="1"' : ''
	runProps += opts.strike ? ' strike="sngStrike"' : ''
	runProps += opts.underline || opts.hyperlink ? ' u="sng"' : ''
	runProps += opts.subscript ? ' baseline="-40000"' : opts.superscript ? ' baseline="30000"' : ''
	runProps += opts.charSpacing ? ' spc="' + opts.charSpacing * 100 + '" kern="0"' : '' // IMPORTANT: Also disable kerning; otherwise text won't actually expand
	runProps += ' dirty="0" smtClean="0">'
	// Color / Font / Outline are children of <a:rPr>, so add them now before closing the runProperties tag
	if (opts.color || opts.fontFace || opts.outline) {
		if (opts.outline && typeof opts.outline === 'object') {
			runProps += '<a:ln w="' + Math.round((opts.outline.size || 0.75) * ONEPT) + '">' + genXmlColorSelection(opts.outline.color || 'FFFFFF') + '</a:ln>'
		}
		if (opts.color) runProps += genXmlColorSelection(opts.color)
		if (opts.fontFace) {
			// NOTE: 'cs' = Complex Script, 'ea' = East Asian (use -120 instead of 0 - see Issue #174); ea must come first (see Issue #174)
			runProps +=
				'<a:latin typeface="' +
				opts.fontFace +
				'" pitchFamily="34" charset="0"/>' +
				'<a:ea typeface="' +
				opts.fontFace +
				'" pitchFamily="34" charset="-122"/>' +
				'<a:cs typeface="' +
				opts.fontFace +
				'" pitchFamily="34" charset="-120"/>'
		}
	}

	// Hyperlink support
	if (opts.hyperlink) {
		if (typeof opts.hyperlink !== 'object') console.log("ERROR: text `hyperlink` option should be an object. Ex: `hyperlink:{url:'https://github.com'}` ")
		else if (!opts.hyperlink.url && !opts.hyperlink.slide) console.log("ERROR: 'hyperlink requires either `url` or `slide`'")
		else if (opts.hyperlink.url) {
			// FIXME-20170410: FUTURE-FEATURE: color (link is always blue in Keynote and PPT online, so usual text run above isnt honored for links..?)
			//runProps += '<a:uFill>'+ genXmlColorSelection('0000FF') +'</a:uFill>'; // Breaks PPT2010! (Issue#74)
			runProps +=
				'<a:hlinkClick r:id="rId' +
				opts.hyperlink.rId +
				'" invalidUrl="" action="" tgtFrame="" tooltip="' +
				(opts.hyperlink.tooltip ? encodeXmlEntities(opts.hyperlink.tooltip) : '') +
				'" history="1" highlightClick="0" endSnd="0"/>'
		} else if (opts.hyperlink.slide) {
			runProps +=
				'<a:hlinkClick r:id="rId' +
				opts.hyperlink.rId +
				'" action="ppaction://hlinksldjump" tooltip="' +
				(opts.hyperlink.tooltip ? encodeXmlEntities(opts.hyperlink.tooltip) : '') +
				'"/>'
		}
	}

	// END runProperties
	runProps += '</' + runPropsTag + '>'

	return runProps
}

/**
* Builds <a:r></a:r> text runs for <a:p> paragraphs in textBody
* @param {Object} opts - various options
* @param {string} paraText - various options
* @return {string} XML string
* @example
* <a:r>
*   <a:rPr lang="en-US" sz="2800" dirty="0" smtClean="0">
* 	<a:solidFill>
* 	  <a:srgbClr val="00FF00">
* 	  </a:srgbClr>
* 	</a:solidFill>
* 	<a:latin typeface="Courier New" pitchFamily="34" charset="0"/>
*   </a:rPr>
*   <a:t>Misc font/color, size = 28</a:t>
* </a:r>
*/
function genXmlTextRun(opts, paraText:string):string {
	let xmlTextRun = ''
	let paraProp = ''
	let arrLines = []

	// 1: ADD runProperties
	let startInfo = genXmlTextRunProperties(opts, false)

	// 2: LINE-BREAKS/MULTI-LINE: Split text into multi-p:
	arrLines = paraText.split(CRLF)
	if (arrLines.length > 1) {
		var outTextData = ''
		for (var i = 0, total_size_i = arrLines.length; i < total_size_i; i++) {
			outTextData += '<a:r>' + startInfo + '<a:t>' + encodeXmlEntities(arrLines[i])
			// Stop/Start <p>aragraph as long as there is more lines ahead (otherwise its closed at the end of this function)
			if (i + 1 < total_size_i) outTextData += (opts.breakLine ? CRLF : '') + '</a:t></a:r>'
		}
		xmlTextRun = outTextData
	} else {
		// Handle cases where addText `text` was an array of objects - if a text object doesnt contain a '\n' it still need alignment!
		// The first pPr-align is done in makeXml - use line countr to ensure we only add subsequently as needed
		xmlTextRun = (opts.align && opts.lineIdx > 0 ? paraProp : '') + '<a:r>' + startInfo + '<a:t>' + encodeXmlEntities(paraText)
	}

	// Return paragraph with text run
	return xmlTextRun + '</a:t></a:r>'
}

/**
 * Builds `<a:bodyPr></a:bodyPr>` tag
 * @param {Object} objOptions - various options
 * @return {string} XML string
 */
function genXmlBodyProperties(objOptions): string {
	var bodyProperties = '<a:bodyPr'

	if (objOptions && objOptions.bodyProp) {
		// PPT-2019 EX: <a:bodyPr wrap="square" lIns="1270" tIns="1270" rIns="1270" bIns="1270" rtlCol="0" anchor="ctr"/>

		// A: Enable or disable textwrapping none or square
		bodyProperties += objOptions.bodyProp.wrap ? ' wrap="' + objOptions.bodyProp.wrap + '"' : ' wrap="square"'

		// B: Textbox margins [padding]
		if (objOptions.bodyProp.lIns || objOptions.bodyProp.lIns == 0) bodyProperties += ' lIns="' + objOptions.bodyProp.lIns + '"'
		if (objOptions.bodyProp.tIns || objOptions.bodyProp.tIns == 0) bodyProperties += ' tIns="' + objOptions.bodyProp.tIns + '"'
		if (objOptions.bodyProp.rIns || objOptions.bodyProp.rIns == 0) bodyProperties += ' rIns="' + objOptions.bodyProp.rIns + '"'
		if (objOptions.bodyProp.bIns || objOptions.bodyProp.bIns == 0) bodyProperties += ' bIns="' + objOptions.bodyProp.bIns + '"'

		// C: Add rtl after margins
		bodyProperties += ' rtlCol="0"'

		// D: Add anchorPoints
		if (objOptions.bodyProp.anchor) bodyProperties += ' anchor="' + objOptions.bodyProp.anchor + '"' // VALS: [t,ctr,b]
		if (objOptions.bodyProp.vert) bodyProperties += ' vert="' + objOptions.bodyProp.vert + '"' // VALS: [eaVert,horz,mongolianVert,vert,vert270,wordArtVert,wordArtVertRtl]

		// E: Close <a:bodyPr element
		bodyProperties += '>'

		// F: NEW: Add autofit type tags
		if (objOptions.shrinkText) bodyProperties += '<a:normAutofit fontScale="85000" lnSpcReduction="20000"/>' // MS-PPT > Format Shape > Text Options: "Shrink text on overflow"
		// MS-PPT > Format Shape > Text Options: "Resize shape to fit text" [spAutoFit]
		// NOTE: Use of '<a:noAutofit/>' in lieu of '' below causes issues in PPT-2013
		bodyProperties += objOptions.bodyProp.autoFit !== false ? '<a:spAutoFit/>' : ''

		// LAST: Close bodyProp
		bodyProperties += '</a:bodyPr>'
	} else {
		// DEFAULT:
		bodyProperties += ' wrap="square" rtlCol="0">'
		bodyProperties += '</a:bodyPr>'
	}

	// LAST: Return Close bodyProp
	return objOptions.isTableCell ? '<a:bodyPr/>' : bodyProperties
}

/**
* DESC: Generate the XML for text and its options (bold, bullet, etc) including text runs (word-level formatting)
* EX:
	<p:txBody>
		<a:bodyPr wrap="none" lIns="50800" tIns="50800" rIns="50800" bIns="50800" anchor="ctr">
		</a:bodyPr>
		<a:lstStyle/>
		<a:p>
		  <a:pPr marL="228600" indent="-228600"><a:buSzPct val="100000"/><a:buChar char="&#x2022;"/></a:pPr>
		  <a:r>
			<a:t>bullet 1 </a:t>
		  </a:r>
		  <a:r>
			<a:rPr>
			  <a:solidFill><a:srgbClr val="7B2CD6"/></a:solidFill>
			</a:rPr>
			<a:t>colored text</a:t>
		  </a:r>
		</a:p>
	  </p:txBody>
* NOTES:
* - PPT text lines [lines followed by line-breaks] are createing using <p>-aragraph's
* - Bullets are a paragprah-level formatting device
*
* @param slideObj (object) - slideObj -OR- table `cell` object
* @returns XML string containing the param object's text and formatting
*/
export function genXmlTextBody(slideObj) {
	// FIRST: Shapes without text, etc. may be sent here during build, but have no text to render so return an empty string
	if (slideObj.options && !slideObj.options.isTableCell && (typeof slideObj.text === 'undefined' || slideObj.text == null)) return ''

	// Create options if needed
	if (!slideObj.options) slideObj.options = {}

	// Vars
	var arrTextObjects = []
	var tagStart = slideObj.options.isTableCell ? '<a:txBody>' : '<p:txBody>'
	var tagClose = slideObj.options.isTableCell ? '</a:txBody>' : '</p:txBody>'
	var strSlideXml = tagStart

	// STEP 1: Modify slideObj to be consistent array of `{ text:'', options:{} }`
	/* CASES:
		addText( 'string' )
		addText( 'line1\n line2' )
		addText( ['barry','allen'] )
		addText( [{text'word1'}, {text:'word2'}] )
		addText( [{text'line1\n line2'}, {text:'end word'}] )
	*/
	// A: Handle string/number
	if (typeof slideObj.text === 'string' || typeof slideObj.text === 'number') {
		slideObj.text = [{ text: slideObj.text.toString(), options: slideObj.options || {} }]
	}

	// STEP 2: Grab options, format line-breaks, etc.
	if (Array.isArray(slideObj.text)) {
		slideObj.text.forEach((obj, idx) => {
			// A: Set options
			obj.options = obj.options || slideObj.options || {}
			if (idx == 0 && obj.options && !obj.options.bullet && slideObj.options.bullet) obj.options.bullet = slideObj.options.bullet

			// B: Cast to text-object and fix line-breaks (if needed)
			if (typeof obj.text === 'string' || typeof obj.text === 'number') {
				obj.text = obj.text.toString().replace(/\r*\n/g, CRLF)
				// Plain strings like "hello \n world" need to have lineBreaks set to break as intended
				if (obj.text.indexOf(CRLF) > -1) obj.options.breakLine = true
			}

			// C: If text string has line-breaks, then create a separate text-object for each (much easier than dealing with split inside a loop below)
			if (obj.text.split(CRLF).length > 0) {
				obj.text
					.toString()
					.split(CRLF)
					.forEach((line, idx) => {
						// Add line-breaks if not bullets/aligned (we add CRLF for those below in STEP 2)
						line += obj.options.breakLine && !obj.options.bullet && !obj.options.align ? CRLF : ''
						arrTextObjects.push({ text: line, options: obj.options })
					})
			} else {
				// NOTE: The replace used here is for non-textObjects (plain strings) eg:'hello\nworld'
				arrTextObjects.push(obj)
			}
		})
	}

	// STEP 3: Add bodyProperties
	{
		// A: 'bodyPr'
		strSlideXml += genXmlBodyProperties(slideObj.options)

		// B: 'lstStyle'
		// NOTE: Shape type 'LINE' has different text align needs (a lstStyle.lvl1pPr between bodyPr and p)
		// FIXME: LINE horiz-align doesnt work (text is always to the left inside line) (FYI: the PPT code diff is substantial!)
		if (slideObj.options.h == 0 && slideObj.options.line && slideObj.options.align) {
			strSlideXml += '<a:lstStyle><a:lvl1pPr algn="l"/></a:lstStyle>'
		} else if (slideObj.type === 'placeholder') {
			strSlideXml += '<a:lstStyle>'
			strSlideXml += genXmlParagraphProperties(slideObj, true)
			strSlideXml += '</a:lstStyle>'
		} else {
			strSlideXml += '<a:lstStyle/>'
		}
	}

	// STEP 4: Loop over each text object and create paragraph props, text run, etc.
	arrTextObjects.forEach((textObj, idx) => {
		// Clear/Increment loop vars
		paragraphPropXml = '<a:pPr ' + (textObj.options.rtlMode ? ' rtl="1" ' : '')
		textObj.options.lineIdx = idx

		// Inherit pPr-type options from parent shape's `options`
		textObj.options.align = textObj.options.align || slideObj.options.align
		textObj.options.lineSpacing = textObj.options.lineSpacing || slideObj.options.lineSpacing
		textObj.options.indentLevel = textObj.options.indentLevel || slideObj.options.indentLevel
		textObj.options.paraSpaceBefore = textObj.options.paraSpaceBefore || slideObj.options.paraSpaceBefore
		textObj.options.paraSpaceAfter = textObj.options.paraSpaceAfter || slideObj.options.paraSpaceAfter

		textObj.options.lineIdx = idx
		var paragraphPropXml = genXmlParagraphProperties(textObj, false)

		// B: Start paragraph if this is the first text obj, or if current textObj is about to be bulleted or aligned
		if (idx == 0) {
			// Add paragraphProperties right after <p> before textrun(s) begin
			strSlideXml += '<a:p>' + paragraphPropXml
		} else if (idx > 0 && (typeof textObj.options.bullet !== 'undefined' || typeof textObj.options.align !== 'undefined')) {
			strSlideXml += '</a:p><a:p>' + paragraphPropXml
		}

		// C: Inherit any main options (color, fontSize, etc.)
		// We only pass the text.options to genXmlTextRun (not the Slide.options),
		// so the run building function cant just fallback to Slide.color, therefore, we need to do that here before passing options below.
		// TODO-3: convert to Object.values or whatever in ES6
		jQuery.each(slideObj.options, (key, val) => {
			// NOTE: This loop will pick up unecessary keys (`x`, etc.), but it doesnt hurt anything
			if (key != 'bullet' && !textObj.options[key]) textObj.options[key] = val
		})

		// D: Add formatted textrun
		strSlideXml += genXmlTextRun(textObj.options, textObj.text)
	})

	// STEP 5: Append 'endParaRPr' (when needed) and close current open paragraph
	// NOTE: (ISSUE#20/#193): Add 'endParaRPr' with font/size props or PPT default (Arial/18pt en-us) is used making row "too tall"/not honoring options
	if (slideObj.options.isTableCell && (slideObj.options.fontSize || slideObj.options.fontFace)) {
		strSlideXml +=
			'<a:endParaRPr lang="' +
			(slideObj.options.lang ? slideObj.options.lang : 'en-US') +
			'" ' +
			(slideObj.options.fontSize ? ' sz="' + Math.round(slideObj.options.fontSize) + '00"' : '') +
			' dirty="0">'
		if (slideObj.options.fontFace) {
			strSlideXml += '  <a:latin typeface="' + slideObj.options.fontFace + '" charset="0"/>'
			strSlideXml += '  <a:ea    typeface="' + slideObj.options.fontFace + '" charset="0"/>'
			strSlideXml += '  <a:cs    typeface="' + slideObj.options.fontFace + '" charset="0"/>'
		}
		strSlideXml += '</a:endParaRPr>'
	} else {
		strSlideXml += '<a:endParaRPr lang="' + (slideObj.options.lang || 'en-US') + '" dirty="0"/>' // NOTE: Added 20180101 to address PPT-2007 issues
	}
	strSlideXml += '</a:p>'

	// STEP 6: Close the textBody
	strSlideXml += tagClose

	// LAST: Return XML
	return strSlideXml
}

export function genXmlPlaceholder(placeholderObj) {
	var strXml = ''

	if (placeholderObj) {
		var placeholderIdx = placeholderObj.options && placeholderObj.options.placeholderIdx ? placeholderObj.options.placeholderIdx : ''
		var placeholderType = placeholderObj.options && placeholderObj.options.placeholderType ? placeholderObj.options.placeholderType : ''

		strXml +=
			'<p:ph' +
			(placeholderIdx ? ' idx="' + placeholderIdx + '"' : '') +
			(placeholderType && PLACEHOLDER_TYPES[placeholderType] ? ' type="' + PLACEHOLDER_TYPES[placeholderType] + '"' : '') +
			(placeholderObj.text && placeholderObj.text.length > 0 ? ' hasCustomPrompt="1"' : '') +
			'/>'
	}
	return strXml
}

// XML-GEN: First 6 functions create the base /ppt files

export function makeXmlContTypes(slides: ISlide[], slideLayouts: ISlideLayout[], masterSlide?: ISlide): string {
	let strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml += '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
	strXml += '<Default Extension="xml" ContentType="application/xml"/>'
	strXml += '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
	strXml += '<Default Extension="jpeg" ContentType="image/jpeg"/>'
	strXml += '<Default Extension="jpg" ContentType="image/jpg"/>'

	// STEP 1: Add standard/any media types used in Presenation
	strXml += '<Default Extension="png" ContentType="image/png"/>'
	strXml += '<Default Extension="gif" ContentType="image/gif"/>'
	strXml += '<Default Extension="m4v" ContentType="video/mp4"/>' // NOTE: Hard-Code this extension as it wont be created in loop below (as extn != type)
	strXml += '<Default Extension="mp4" ContentType="video/mp4"/>' // NOTE: Hard-Code this extension as it wont be created in loop below (as extn != type)
	slides.forEach(slide => {
		;(slide.relsMedia || []).forEach(rel => {
			if (rel.type != 'image' && rel.type != 'online' && rel.type != 'chart' && rel.extn != 'm4v' && strXml.indexOf(rel.type) == -1) {
				strXml += '<Default Extension="' + rel.extn + '" ContentType="' + rel.type + '"/>'
			}
		})
	})
	strXml += '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>'
	strXml += '<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>'

	// STEP 2: Add presentation and slide master(s)/slide(s)
	strXml += '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
	strXml += '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>'
	slides.forEach((slide, idx) => {
		strXml +=
			'<Override PartName="/ppt/slideMasters/slideMaster' +
			(idx + 1) +
			'.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
		strXml += '<Override PartName="/ppt/slides/slide' + (idx + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
		// Add charts if any
		slide.relsChart.forEach(rel => {
			strXml += ' <Override PartName="' + rel.Target + '" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
		})
	})

	// STEP 3: Core PPT
	strXml += '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>'
	strXml += '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>'
	strXml += '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
	strXml += '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>'

	// STEP 4: Add Slide Layouts
	slideLayouts.forEach((layout, idx) => {
		strXml +=
			'<Override PartName="/ppt/slideLayouts/slideLayout' +
			(idx + 1) +
			'.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
		;(layout.relsChart || []).forEach(rel => {
			strXml += ' <Override PartName="' + rel.Target + '" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
		})
	})

	// STEP 5: Add notes slide(s)
	slides.forEach((_slide, idx) => {
		strXml +=
			' <Override PartName="/ppt/notesSlides/notesSlide' +
			(idx + 1) +
			'.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>'
	})

	// STEP 6: Add rels
	masterSlide.relsChart.forEach(rel => {
		strXml += ' <Override PartName="' + rel.Target + '" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
	})
	masterSlide.relsMedia.forEach(rel => {
		if (rel.type != 'image' && rel.type != 'online' && rel.type != 'chart' && rel.extn != 'm4v' && strXml.indexOf(rel.type) == -1)
			strXml += ' <Default Extension="' + rel.extn + '" ContentType="' + rel.type + '"/>'
	})

	// LAST: Finish XML (Resume core)
	strXml += ' <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
	strXml += ' <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
	strXml += '</Types>'

	return strXml
}

export function makeXmlRootRels() {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		CRLF +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
		'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
		'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>' +
		'</Relationships>'
	)
}

export function makeXmlApp(slides: Array<ISlide>, company: string): string {
	let strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml +=
		'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
	strXml += '<TotalTime>0</TotalTime>'
	strXml += '<Words>0</Words>'
	strXml += '<Application>Microsoft Office PowerPoint</Application>'
	strXml += '<PresentationFormat>On-screen Show (16:9)</PresentationFormat>'
	strXml += '<Paragraphs>0</Paragraphs>'
	strXml += '<Slides>' + slides.length + '</Slides>'
	strXml += '<Notes>' + slides.length + '</Notes>'
	strXml += '<HiddenSlides>0</HiddenSlides>'
	strXml += '<MMClips>0</MMClips>'
	strXml += '<ScaleCrop>false</ScaleCrop>'
	strXml += '<HeadingPairs>'
	strXml += '<vt:vector size="6" baseType="variant">'
	strXml += '<vt:variant><vt:lpstr>Fonts Used</vt:lpstr></vt:variant>'
	strXml += '<vt:variant><vt:i4>2</vt:i4></vt:variant>'
	strXml += '<vt:variant><vt:lpstr>Theme</vt:lpstr></vt:variant>'
	strXml += '<vt:variant><vt:i4>1</vt:i4></vt:variant>'
	strXml += '<vt:variant><vt:lpstr>Slide Titles</vt:lpstr></vt:variant>'
	strXml += '<vt:variant><vt:i4>' + slides.length + '</vt:i4></vt:variant>'
	strXml += '</vt:vector>'
	strXml += '</HeadingPairs>'
	strXml += '<TitlesOfParts>'
	strXml += '<vt:vector size="' + (slides.length + 1 + 2) + '" baseType="lpstr">'
	strXml += '<vt:lpstr>Arial</vt:lpstr>'
	strXml += '<vt:lpstr>Calibri</vt:lpstr>'
	strXml += '<vt:lpstr>Office Theme</vt:lpstr>'
	slides.forEach((_slideObj, idx) => {
		strXml += '<vt:lpstr>Slide ' + (idx + 1) + '</vt:lpstr>'
	})
	strXml += '</vt:vector>'
	strXml += '</TitlesOfParts>'
	strXml += '<Company>' + company + '</Company>'
	strXml += '<LinksUpToDate>false</LinksUpToDate>'
	strXml += '<SharedDoc>false</SharedDoc>'
	strXml += '<HyperlinksChanged>false</HyperlinksChanged>'
	strXml += '<AppVersion>16.0000</AppVersion>'
	strXml += '</Properties>'

	return strXml
}

export function makeXmlCore(title: string, subject: string, author: string, revision: string): string {
	let strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml +=
		'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
	strXml += '<dc:title>' + encodeXmlEntities(title) + '</dc:title>'
	strXml += '<dc:subject>' + encodeXmlEntities(subject) + '</dc:subject>'
	strXml += '<dc:creator>' + encodeXmlEntities(author) + '</dc:creator>'
	strXml += '<cp:lastModifiedBy>' + encodeXmlEntities(author) + '</cp:lastModifiedBy>'
	strXml += '<cp:revision>' + revision + '</cp:revision>'
	strXml += '<dcterms:created xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d\d\dZ/, 'Z') + '</dcterms:created>'
	strXml += '<dcterms:modified xsi:type="dcterms:W3CDTF">' + new Date().toISOString().replace(/\.\d\d\dZ/, 'Z') + '</dcterms:modified>'
	strXml += '</cp:coreProperties>'
	return strXml
}

export function makeXmlPresentationRels(slides: Array<ISlide>): string {
	let intRelNum = 1
	let strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml += '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
	strXml += '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>'
	for (var idx = 1; idx <= slides.length; idx++) {
		strXml +=
			'<Relationship Id="rId' + ++intRelNum + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide' + idx + '.xml"/>'
	}
	intRelNum++
	strXml +=
		'<Relationship Id="rId' +
		intRelNum +
		'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>' +
		'<Relationship Id="rId' +
		(intRelNum + 1) +
		'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps" Target="presProps.xml"/>' +
		'<Relationship Id="rId' +
		(intRelNum + 2) +
		'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps" Target="viewProps.xml"/>' +
		'<Relationship Id="rId' +
		(intRelNum + 3) +
		'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>' +
		'<Relationship Id="rId' +
		(intRelNum + 4) +
		'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>' +
		'</Relationships>'

	return strXml
}

// XML-GEN: Next 5 functions run 1-N times (once for each Slide)

/**
 * Generates XML for the slide file (`ppt/slides/slide1.xml`)
 * @param {Object} objSlide - the slide object to transform into XML
 * @return {string} strXml - slide OOXML
 */
export function makeXmlSlide(slide: ISlide): string {
	// Generate slide XML - wrap generated text in full XML envelope
	let strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml +=
		'<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
		(slide && slide.hidden ? ' show="0"' : '') +
		'>'
	strXml += slideObjectToXml(slide)
	strXml += '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
	strXml += '</p:sld>'

	return strXml
}

export function getNotesFromSlide(objSlide: ISlide): string {
	var notesStr = ''
	objSlide.data.forEach(data => {
		if (data.type === 'notes') {
			notesStr += data.text
		}
	})
	return notesStr.replace(/\r*\n/g, CRLF)
}

/**
 * Generate XML for Notes Master (notesMaster1.xml)
 * @returns {string} XML
 */
export function makeXmlNotesMaster(): string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${CRLF}<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Header Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="hdr" sz="quarter"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2971800" cy="458788"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Date Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="dt" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="3884613" y="0"/><a:ext cx="2971800" cy="458788"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{5282F153-3F37-0F45-9E97-73ACFA13230C}" type="datetimeFigureOut"><a:rPr lang="en-US" smtClean="0"/><a:t>7/23/19</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Image Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="5" name="Notes Placeholder 4"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Second level</a:t></a:r></a:p><a:p><a:pPr lvl="2"/><a:r><a:rPr lang="en-US"/><a:t>Third level</a:t></a:r></a:p><a:p><a:pPr lvl="3"/><a:r><a:rPr lang="en-US"/><a:t>Fourth level</a:t></a:r></a:p><a:p><a:pPr lvl="4"/><a:r><a:rPr lang="en-US"/><a:t>Fifth level</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="6" name="Footer Placeholder 5"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ftr" sz="quarter" idx="4"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="8685213"/><a:ext cx="2971800" cy="458787"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="b"/><a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="7" name="Slide Number Placeholder 6"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="5"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="3884613" y="8685213"/><a:ext cx="2971800" cy="458787"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="b"/><a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{CE5E9CC1-C706-0F49-92D6-E571CC5EEA8F}" type="slidenum"><a:rPr lang="en-US" smtClean="0"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree><p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1024086991"/></p:ext></p:extLst></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr><a:lvl2pPr marL="457200" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl2pPr><a:lvl3pPr marL="914400" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl3pPr><a:lvl4pPr marL="1371600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl4pPr><a:lvl5pPr marL="1828800" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl5pPr><a:lvl6pPr marL="2286000" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl6pPr><a:lvl7pPr marL="2743200" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl7pPr><a:lvl8pPr marL="3200400" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl8pPr><a:lvl9pPr marL="3657600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl9pPr></p:notesStyle></p:notesMaster>`
}

/**
 * Creates Notes Slide (`ppt/notesSlides/notesSlide1.xml`)
 */
export function makeXmlNotesSlide(objSlide: ISlide): string {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		CRLF +
		'<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
		'<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/>' +
		'<p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
		'<a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/>' +
		'</a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/>' +
		'<p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr>' +
		'<p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/>' +
		'</p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>' +
		'<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' +
		'<p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>' +
		'<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>' +
		'<a:rPr lang="en-US" dirty="0" smtClean="0"/><a:t>' +
		encodeXmlEntities(getNotesFromSlide(objSlide)) +
		'</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody>' +
		'</p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder 3"/>' +
		'<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' +
		'<p:ph type="sldNum" sz="quarter" idx="10"/></p:nvPr></p:nvSpPr>' +
		'<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>' +
		'<a:fld id="' +
		SLDNUMFLDID +
		'" type="slidenum">' +
		'<a:rPr lang="en-US" smtClean="0"/><a:t>' +
		objSlide.number +
		'</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>' +
		'</p:spTree><p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}">' +
		'<p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1024086991"/>' +
		'</p:ext></p:extLst></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>'
	)
}

/**
 * Generates the XML layout resource from a layout object
 *
 * @param {ISlide} objSlideLayout - slide object that represents layout
 * @return {string} strXml - slide OOXML
 */
export function makeXmlLayout(layout: ISlideLayout): string {
	// STEP 1: Generate slide XML - wrap generated text in full XML envelope
	let strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml +=
		'<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" preserve="1">'
	strXml += slideObjectToXml(layout)
	strXml += '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>'
	strXml += '</p:sldLayout>'

	return strXml
}

/**
 * Generates XML for the slide master file (`ppt/slideMasters/slideMaster1.xml`)
 * @param {ISlide} objSlide - slide object that represents master slide layout
 * @param {ISlideLayout[]} slideLayouts - slide layouts
 * @return {string} strXml - slide OOXML
 */
export function makeXmlMaster(slide: ISlide, layouts: Array<ISlideLayout>): string {
	// NOTE: Pass layouts as static rels because they are not referenced any time
	let layoutDefs = layouts.map((_layoutDef, idx) => {
		return '<p:sldLayoutId id="' + (LAYOUT_IDX_SERIES_BASE + idx) + '" r:id="rId' + (slide.rels.length + idx + 1) + '"/>'
	})

	let strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml +=
		'<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
	strXml += slideObjectToXml(slide)
	strXml +=
		'<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
	strXml += '<p:sldLayoutIdLst>' + layoutDefs.join('') + '</p:sldLayoutIdLst>'
	strXml += '<p:hf sldNum="0" hdr="0" ftr="0" dt="0"/>'
	strXml +=
		'<p:txStyles>' +
		' <p:titleStyle>' +
		'  <a:lvl1pPr algn="ctr" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/><a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr>' +
		' </p:titleStyle>' +
		' <p:bodyStyle>' +
		'  <a:lvl1pPr marL="342900" indent="-342900" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="3200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>' +
		'  <a:lvl2pPr marL="742950" indent="-285750" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="–"/><a:defRPr sz="2800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl2pPr>' +
		'  <a:lvl3pPr marL="1143000" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="2400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl3pPr>' +
		'  <a:lvl4pPr marL="1600200" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="–"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl4pPr>' +
		'  <a:lvl5pPr marL="2057400" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="»"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl5pPr>' +
		'  <a:lvl6pPr marL="2514600" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl6pPr>' +
		'  <a:lvl7pPr marL="2971800" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl7pPr>' +
		'  <a:lvl8pPr marL="3429000" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl8pPr>' +
		'  <a:lvl9pPr marL="3886200" indent="-228600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:spcBef><a:spcPct val="20000"/></a:spcBef><a:buFont typeface="Arial" pitchFamily="34" charset="0"/><a:buChar char="•"/><a:defRPr sz="2000" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl9pPr>' +
		' </p:bodyStyle>' +
		' <p:otherStyle>' +
		'  <a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' +
		'  <a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr>' +
		'  <a:lvl2pPr marL="457200" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl2pPr>' +
		'  <a:lvl3pPr marL="914400" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl3pPr>' +
		'  <a:lvl4pPr marL="1371600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl4pPr>' +
		'  <a:lvl5pPr marL="1828800" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl5pPr>' +
		'  <a:lvl6pPr marL="2286000" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl6pPr>' +
		'  <a:lvl7pPr marL="2743200" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl7pPr>' +
		'  <a:lvl8pPr marL="3200400" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl8pPr>' +
		'  <a:lvl9pPr marL="3657600" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl9pPr>' +
		' </p:otherStyle>' +
		'</p:txStyles>'
	strXml += '</p:sldMaster>'

	return strXml
}

/**
 * Generates XML string for a slide layout relation file.
 * @param {Number} layoutNumber - 1-indexed number of a layout that relations are generated for
 * @return {String} complete XML string ready to be saved as a file
 */
export function makeXmlSlideLayoutRel(layoutNumber: number, slideLayouts: Array<ISlideLayout>): string {
	return slideObjectRelationsToXml(slideLayouts[layoutNumber - 1], [
		{
			target: '../slideMasters/slideMaster1.xml',
			type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
		},
	])
}

/**
 * Generates XML string for a slide relation file.
 * @param {Array<ISlide>} `slides`
 * @param {Array<ISlideLayout>} `slideLayouts`
 * @param {number} `slideNumber` 1-indexed number of a layout that relations are generated for
 * @return {string} XML
 */
export function makeXmlSlideRel(slides: Array<ISlide>, slideLayouts: Array<ISlideLayout>, slideNumber: number): string {
	return slideObjectRelationsToXml(slides[slideNumber - 1], [
		{
			target: '../slideLayouts/slideLayout' + getLayoutIdxForSlide(slides, slideLayouts, slideNumber) + '.xml',
			type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
		},
		{
			target: '../notesSlides/notesSlide' + slideNumber + '.xml',
			type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
		},
	])
}

/**
 * Generates XML string for a slide relation file.
 * @param {Number} `slideNumber` 1-indexed number of a layout that relations are generated for
 * @return {String} complete XML string ready to be saved as a file
 */
export function makeXmlNotesSlideRel(slideNumber: number): string {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		CRLF +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/>' +
		'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide' +
		slideNumber +
		'.xml"/>' +
		'</Relationships>'
	)
}

/**
 * Generates XML string for the master file
 * @param {ISlide} `masterSlideObject` - slide object
 * @return {String} complete XML string ready to be saved as a file
 */
export function makeXmlMasterRel(masterSlideObject: ISlide, slideLayouts: Array<ISlideLayout>): string {
	var defaultRels = slideLayouts.map((_layoutDef, idx) => {
		return { target: '../slideLayouts/slideLayout' + (idx + 1) + '.xml', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout' }
	})
	defaultRels.push({ target: '../theme/theme1.xml', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme' })

	return slideObjectRelationsToXml(masterSlideObject, defaultRels)
}

export function makeXmlNotesMasterRel(): string {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		CRLF +
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
		'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>' +
		'</Relationships>'
	)
}

/**
 * For the passed slide number, resolves name of a layout that is used for.
 * @param {ISlide[]} `slides` - Array of slides
 * @param {Number} `slideLayouts`
 * @param {Number} slideNumber
 * @return {Number} slide number
 */
function getLayoutIdxForSlide(slides: Array<ISlide>, slideLayouts: Array<ISlideLayout>, slideNumber: number): number {
	for (let i = 0; i < slideLayouts.length; i++) {
		if (slideLayouts[i].name === slides[slideNumber - 1].slideLayout.name) {
			return i + 1
		}
	}

	// IMPORTANT: Return 1 (for `slideLayout1.xml`) when no def is found
	// So all objects are in Layout1 and every slide that references it uses this layout.
	return 1
}

// XML-GEN: Last 5 functions create root /ppt files

export function makeXmlTheme() {
	// FIXME: old below!
	/*
	var strXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + CRLF
	strXml +=
		'<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">\
					<a:themeElements>\
					  <a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>\
					  <a:dk2><a:srgbClr val="A7A7A7"/></a:dk2>\
					  <a:lt2><a:srgbClr val="535353"/></a:lt2>\
					  <a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5>\
					  <a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme>\
					  <a:fontScheme name="Office">\
					  <a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="Yu Gothic Light"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="DengXian Light"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Times New Roman"/><a:font script="Hebr" typeface="Times New Roman"/><a:font script="Thai" typeface="Angsana New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="MoolBoran"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Times New Roman"/><a:font script="Uigh" typeface="Microsoft Uighur"/></a:majorFont>\
					  <a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="Yu Gothic"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="DengXian"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Arial"/><a:font script="Hebr" typeface="Arial"/><a:font script="Thai" typeface="Cordia New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="DaunPenh"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Arial"/><a:font script="Uigh" typeface="Microsoft Uighur"/>\
					  </a:minorFont></a:fontScheme>\
					  <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="35000"><a:schemeClr val="phClr"><a:tint val="37000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="15000"/><a:satMod val="350000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="1"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:shade val="51000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="80000"><a:schemeClr val="phClr"><a:shade val="93000"/><a:satMod val="130000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="94000"/><a:satMod val="135000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="16200000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/><a:satMod val="105000"/></a:schemeClr></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln><a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="20000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="38000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst><a:scene3d><a:camera prst="orthographicFront"><a:rot lat="0" lon="0" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"><a:rot lat="0" lon="0" rev="1200000"/></a:lightRig></a:scene3d><a:sp3d><a:bevelT w="63500" h="25400"/></a:sp3d></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="40000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="40000"><a:schemeClr val="phClr"><a:tint val="45000"/><a:shade val="99000"/><a:satMod val="350000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="20000"/><a:satMod val="255000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="-80000" r="50000" b="180000"/></a:path></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="80000"/><a:satMod val="300000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="30000"/><a:satMod val="200000"/></a:schemeClr></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/>\
					</a:theme>'
	return strXml
	*/
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${CRLF}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri Light" panose="020F0302020204030204"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="游ゴシック Light"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="等线 Light"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Times New Roman"/><a:font script="Hebr" typeface="Times New Roman"/><a:font script="Thai" typeface="Angsana New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="MoolBoran"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Times New Roman"/><a:font script="Uigh" typeface="Microsoft Uighur"/><a:font script="Geor" typeface="Sylfaen"/><a:font script="Armn" typeface="Arial"/><a:font script="Bugi" typeface="Leelawadee UI"/><a:font script="Bopo" typeface="Microsoft JhengHei"/><a:font script="Java" typeface="Javanese Text"/><a:font script="Lisu" typeface="Segoe UI"/><a:font script="Mymr" typeface="Myanmar Text"/><a:font script="Nkoo" typeface="Ebrima"/><a:font script="Olck" typeface="Nirmala UI"/><a:font script="Osma" typeface="Ebrima"/><a:font script="Phag" typeface="Phagspa"/><a:font script="Syrn" typeface="Estrangelo Edessa"/><a:font script="Syrj" typeface="Estrangelo Edessa"/><a:font script="Syre" typeface="Estrangelo Edessa"/><a:font script="Sora" typeface="Nirmala UI"/><a:font script="Tale" typeface="Microsoft Tai Le"/><a:font script="Talu" typeface="Microsoft New Tai Lue"/><a:font script="Tfng" typeface="Ebrima"/></a:majorFont><a:minorFont><a:latin typeface="Calibri" panose="020F0502020204030204"/><a:ea typeface=""/><a:cs typeface=""/><a:font script="Jpan" typeface="游ゴシック"/><a:font script="Hang" typeface="맑은 고딕"/><a:font script="Hans" typeface="等线"/><a:font script="Hant" typeface="新細明體"/><a:font script="Arab" typeface="Arial"/><a:font script="Hebr" typeface="Arial"/><a:font script="Thai" typeface="Cordia New"/><a:font script="Ethi" typeface="Nyala"/><a:font script="Beng" typeface="Vrinda"/><a:font script="Gujr" typeface="Shruti"/><a:font script="Khmr" typeface="DaunPenh"/><a:font script="Knda" typeface="Tunga"/><a:font script="Guru" typeface="Raavi"/><a:font script="Cans" typeface="Euphemia"/><a:font script="Cher" typeface="Plantagenet Cherokee"/><a:font script="Yiii" typeface="Microsoft Yi Baiti"/><a:font script="Tibt" typeface="Microsoft Himalaya"/><a:font script="Thaa" typeface="MV Boli"/><a:font script="Deva" typeface="Mangal"/><a:font script="Telu" typeface="Gautami"/><a:font script="Taml" typeface="Latha"/><a:font script="Syrc" typeface="Estrangelo Edessa"/><a:font script="Orya" typeface="Kalinga"/><a:font script="Mlym" typeface="Kartika"/><a:font script="Laoo" typeface="DokChampa"/><a:font script="Sinh" typeface="Iskoola Pota"/><a:font script="Mong" typeface="Mongolian Baiti"/><a:font script="Viet" typeface="Arial"/><a:font script="Uigh" typeface="Microsoft Uighur"/><a:font script="Geor" typeface="Sylfaen"/><a:font script="Armn" typeface="Arial"/><a:font script="Bugi" typeface="Leelawadee UI"/><a:font script="Bopo" typeface="Microsoft JhengHei"/><a:font script="Java" typeface="Javanese Text"/><a:font script="Lisu" typeface="Segoe UI"/><a:font script="Mymr" typeface="Myanmar Text"/><a:font script="Nkoo" typeface="Ebrima"/><a:font script="Olck" typeface="Nirmala UI"/><a:font script="Osma" typeface="Ebrima"/><a:font script="Phag" typeface="Phagspa"/><a:font script="Syrn" typeface="Estrangelo Edessa"/><a:font script="Syrj" typeface="Estrangelo Edessa"/><a:font script="Syre" typeface="Estrangelo Edessa"/><a:font script="Sora" typeface="Nirmala UI"/><a:font script="Tale" typeface="Microsoft Tai Le"/><a:font script="Talu" typeface="Microsoft New Tai Lue"/><a:font script="Tfng" typeface="Ebrima"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"><a:tint val="95000"/><a:satMod val="170000"/></a:schemeClr></a:solidFill><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="93000"/><a:satMod val="150000"/><a:shade val="98000"/><a:lumMod val="102000"/></a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr"><a:tint val="98000"/><a:satMod val="130000"/><a:shade val="90000"/><a:lumMod val="103000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/><a:satMod val="120000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/><a:extLst><a:ext uri="{05A4C25C-085E-4340-85A3-A5531E510DB2}"><thm15:themeFamily xmlns:thm15="http://schemas.microsoft.com/office/thememl/2012/main" name="Office Theme" id="{62F939B6-93AF-4DB8-9C6B-D6C7DFDC589F}" vid="{4A3C46E8-61CC-4603-A589-7422A47A8E4A}"/></a:ext></a:extLst></a:theme>`
}

/**
 * Create presentation file (`ppt/presentation.xml`)
 * @see https://docs.microsoft.com/en-us/office/open-xml/structure-of-a-presentationml-document
 * @see http://www.datypic.com/sc/ooxml/t-p_CT_Presentation.html
 * @param {Array<ISlide>} `slides` presentation slides
 * @param {ISlideLayout} `pptLayout` presentation layout
 */
export function makeXmlPresentation(slides: Array<ISlide>, pptLayout: ILayout) {
	let strXml =
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		CRLF +
		'<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
		'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
		'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
		(this._rtlMode ? 'rtl="1" ' : '') +
		'saveSubsetFonts="1" autoCompressPictures="0">'
	// FIXME: "this._rtlMode" doesnt exist

	// IMPORTANT: Steps 1-2-3 must be in this order or PPT will give corruption message on open!
	// STEP 1: Add slide master
	strXml += '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>'

	// STEP 2: Add all Slides
	strXml += '<p:sldIdLst>'
	for (let idx = 0; idx < slides.length; idx++) {
		strXml += '<p:sldId id="' + (idx + 256) + '" r:id="rId' + (idx + 2) + '"/>'
	}
	strXml += '</p:sldIdLst>'

	// STEP 3: Add Notes Master (NOTE: length+2 is from `presentation.xml.rels` func (since we have to match this rId, we just use same logic))
	strXml += '<p:notesMasterIdLst><p:notesMasterId r:id="rId' + (slides.length + 2) + '"/></p:notesMasterIdLst>'

	// STEP 4: Build SLIDE text styles
	strXml +=
		'<p:sldSz cx="' +
		pptLayout.width +
		'" cy="' +
		pptLayout.height +
		'"/>' +
		'<p:notesSz cx="' +
		pptLayout.height +
		'" cy="' +
		pptLayout.width +
		'"/>' +
		'<p:defaultTextStyle>' //+'<a:defPPr><a:defRPr lang="en-US"/></a:defPPr>'
	for (let idx = 1; idx < 10; idx++) {
		strXml +=
			'<a:lvl' +
			idx +
			'pPr marL="' +
			(idx - 1) * 457200 +
			'" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' +
			'<a:defRPr sz="1800" kern="1200">' +
			'<a:solidFill><a:schemeClr val="tx1"/></a:solidFill>' +
			'<a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/>' +
			'</a:defRPr>' +
			'</a:lvl' +
			idx +
			'pPr>'
	}
	strXml += '</p:defaultTextStyle>'
	strXml += '</p:presentation>'

	return strXml
}

export function makeXmlPresProps() {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		CRLF +
		'<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'
	)
}

/**
 * @see: http://openxmldeveloper.org/discussions/formats/f/13/p/2398/8107.aspx
 */
export function makeXmlTableStyles() {
	return (
		'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
		CRLF +
		'<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>'
	)
}

/**
 * Creates `ppt/viewProps.xml`
 */
export function makeXmlViewProps() {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${CRLF}<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:normalViewPr horzBarState="maximized"><p:restoredLeft sz="15611"/><p:restoredTop sz="94610"/></p:normalViewPr><p:slideViewPr><p:cSldViewPr snapToGrid="0" snapToObjects="1"><p:cViewPr varScale="1"><p:scale><a:sx n="136" d="100"/><a:sy n="136" d="100"/></p:scale><p:origin x="216" y="312"/></p:cViewPr><p:guideLst/></p:cSldViewPr></p:slideViewPr><p:notesTextViewPr><p:cViewPr><p:scale><a:sx n="1" d="1"/><a:sy n="1" d="1"/></p:scale><p:origin x="0" y="0"/></p:cViewPr></p:notesTextViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`
}

/**
 * Checks shadow options passed by user and performs corrections if needed.
 * @param {IShadowOpts} `shadowOpts`
 */
export function correctShadowOptions(shadowOpts: IShadowOpts) {
	if (!shadowOpts || shadowOpts === null) return

	// OPT: `type`
	if (shadowOpts.type != 'outer' && shadowOpts.type != 'inner') {
		console.warn('Warning: shadow.type options are `outer` or `inner`.')
		shadowOpts.type = 'outer'
	}

	// OPT: `angle`
	if (shadowOpts.angle) {
		// A: REALITY-CHECK
		if (isNaN(Number(shadowOpts.angle)) || shadowOpts.angle < 0 || shadowOpts.angle > 359) {
			console.warn('Warning: shadow.angle can only be 0-359')
			shadowOpts.angle = 270
		}

		// B: ROBUST: Cast any type of valid arg to int: '12', 12.3, etc. -> 12
		shadowOpts.angle = Math.round(Number(shadowOpts.angle))
	}

	// OPT: `opacity`
	if (shadowOpts.opacity) {
		// A: REALITY-CHECK
		if (isNaN(Number(shadowOpts.opacity)) || shadowOpts.opacity < 0 || shadowOpts.opacity > 1) {
			console.warn('Warning: shadow.opacity can only be 0-1')
			shadowOpts.opacity = 0.75
		}

		// B: ROBUST: Cast any type of valid arg to int: '12', 12.3, etc. -> 12
		shadowOpts.opacity = Number(shadowOpts.opacity)
	}
}

export function getShapeInfo(shapeName) {
	if (!shapeName) return gObjPptxShapes.RECTANGLE

	if (typeof shapeName == 'object' && shapeName.name && shapeName.displayName && shapeName.avLst) return shapeName

	if (gObjPptxShapes[shapeName]) return gObjPptxShapes[shapeName]

	var objShape = Object.keys(gObjPptxShapes).filter((key: string) => {
		return gObjPptxShapes[key].name == shapeName || gObjPptxShapes[key].displayName
	})[0]
	if (typeof objShape !== 'undefined' && objShape != null) return objShape

	return gObjPptxShapes.RECTANGLE
}

export function createHyperlinkRels(slides: Array<ISlide>, inText, slideRels) {
	var arrTextObjects = []

	// Only text objects can have hyperlinks, so return if this is plain text/number
	if (typeof inText === 'string' || typeof inText === 'number') return
	// IMPORTANT: Check for isArray before typeof=object, or we'll exhaust recursion!
	else if (Array.isArray(inText)) arrTextObjects = inText
	else if (typeof inText === 'object') arrTextObjects = [inText]

	arrTextObjects.forEach(text => {
		// `text` can be an array of other `text` objects (table cell word-level formatting), so use recursion
		if (Array.isArray(text)) createHyperlinkRels(slides, text, slideRels)
		else if (text && typeof text === 'object' && text.options && text.options.hyperlink && !text.options.hyperlink.rId) {
			if (typeof text.options.hyperlink !== 'object') console.log("ERROR: text `hyperlink` option should be an object. Ex: `hyperlink: {url:'https://github.com'}` ")
			else if (!text.options.hyperlink.url && !text.options.hyperlink.slide) console.log("ERROR: 'hyperlink requires either: `url` or `slide`'")
			else {
				var intRels = 0
				slides.forEach((slide, idx) => {
					intRels += slide.rels.length
				})
				var intRelId = intRels + 1

				slideRels.push({
					type: 'hyperlink',
					data: text.options.hyperlink.slide ? 'slide' : 'dummy',
					rId: intRelId,
					Target: text.options.hyperlink.url || text.options.hyperlink.slide,
				})

				text.options.hyperlink.rId = intRelId
			}
		}
	})
}

// TABLE-TO-SLIDES vvvvvvvvvvvvvvvvvvvv

export function getSlidesForTableRows(inArrRows: [ITableToSlidesCell[]?] = [], opts: ITableToSlidesOpts = {}, presLayout: ILayout, masterSlide: ISlideLayout) {
	let arrInchMargins = DEF_SLIDE_MARGIN_IN
	let arrObjSlides = [],
		arrRows = [],
		currRow = [],
		numCols = 0
	let emuTabCurrH = 0,
		emuSlideTabW = EMU * 1,
		emuSlideTabH = EMU * 1

	if (opts.debug) console.log('------------------------------------')
	if (opts.debug) console.log('opts.w ............. = ' + (opts.w || '').toString())
	if (opts.debug) console.log('opts.colW .......... = ' + (opts.colW || '').toString())
	if (opts.debug) console.log('opts.slideMargin ... = ' + (opts.slideMargin || '').toString())

	// NOTE: Use default size as zero cell margin is causing our tables to be too large and touch bottom of slide!
	if (!opts.slideMargin && opts.slideMargin != 0) opts.slideMargin = DEF_SLIDE_MARGIN_IN[0]

	// STEP 1: Calc margins/usable space
	if (opts.slideMargin || opts.slideMargin == 0) {
		if (Array.isArray(opts.slideMargin)) arrInchMargins = opts.slideMargin
		else if (!isNaN(opts.slideMargin)) arrInchMargins = [opts.slideMargin, opts.slideMargin, opts.slideMargin, opts.slideMargin]
	} else if (masterSlide && masterSlide.margin) {
		if (Array.isArray(masterSlide.margin)) arrInchMargins = masterSlide.margin
		else if (!isNaN(masterSlide.margin)) arrInchMargins = [masterSlide.margin, masterSlide.margin, masterSlide.margin, masterSlide.margin]
	}

	// STEP 2: Calc number of columns
	// NOTE: Cells may have a colspan, so merely taking the length of the [0] (or any other) row is not
	// ....: sufficient to determine column count. Therefore, check each cell for a colspan and total cols as reqd
	inArrRows[0].forEach(cell => {
		if (!cell) cell = {}
		let cellOpts = cell.options || null
		numCols += cellOpts && cellOpts.colspan ? cellOpts.colspan : 1
	})

	if (opts.debug) console.log('arrInchMargins ..... = ' + arrInchMargins.toString())
	if (opts.debug) console.log('numCols ............ = ' + numCols)

	// Calc opts.w if we can
	if (!opts.w && opts.colW) {
		if (Array.isArray(opts.colW))
			opts.colW.forEach(val => {
				opts.w += val
			})
		else {
			opts.w = opts.colW * numCols
		}
	}

	// STEP 2: Calc usable space/table size now that we have usable space calc'd
	emuSlideTabW = opts.w ? inch2Emu(opts.w) : presLayout.width - inch2Emu((opts.x || arrInchMargins[1]) + arrInchMargins[3])
	if (opts.debug) console.log('emuSlideTabW (in) ........ = ' + (emuSlideTabW / EMU).toFixed(1))
	if (opts.debug) console.log('presLayout.h ..... = ' + presLayout.height / EMU)

	// STEP 3: Calc column widths if needed so we can subsequently calc lines (we need `emuSlideTabW`!)
	if (!opts.colW || !Array.isArray(opts.colW)) {
		if (opts.colW && !isNaN(Number(opts.colW))) {
			let arrColW = []
			inArrRows[0].forEach(() => {
				arrColW.push(opts.colW)
			})
			opts.colW = []
			arrColW.forEach(val => {
				opts.colW.push(val)
			})
		}
		// No column widths provided? Then distribute cols.
		else {
			opts.colW = []
			for (var iCol = 0; iCol < numCols; iCol++) {
				opts.colW.push(emuSlideTabW / EMU / numCols)
			}
		}
	}

	// STEP 4: Iterate over each line and perform magic =========================
	// NOTE: inArrRows will be an array of {text:'', opts{}} whether from `addSlidesForTable()` or `.addTable()`
	inArrRows.forEach((row, iRow) => {
		// A: Reset ROW variables
		let arrCellsLines = [],
			arrCellsLineHeights: number[] = [],
			intMaxLineCnt = 0,
			intMaxColIdx = 0

		// B: Calc usable vertical space/table height
		// NOTE: Use margins after the first Slide (dont re-use opt.y - it could've been halfway down the page!) (ISSUE#43,ISSUE#47,ISSUE#48)
		if (arrObjSlides.length > 0) {
			emuSlideTabH = presLayout.height - inch2Emu((opts.y / EMU < arrInchMargins[0] ? opts.y / EMU : arrInchMargins[0]) + arrInchMargins[2])
			// Use whichever is greater: area between margins or the table H provided (dont shrink usable area - the whole point of over-riding X on paging is to *increarse* usable space)
			if (emuSlideTabH < opts.h) emuSlideTabH = opts.h
		} else emuSlideTabH = opts.h ? opts.h : presLayout.height - inch2Emu((opts.y / EMU || arrInchMargins[0]) + arrInchMargins[2])
		if (opts.debug) console.log('* Slide ' + arrObjSlides.length + ': emuSlideTabH (in) ........ = ' + (emuSlideTabH / EMU).toFixed(1))

		// C: Parse and store each cell's text into line array (**MAGIC HAPPENS HERE**)
		row.forEach((cell, iCell) => {
			// FIRST: REALITY-CHECK:
			if (!cell) cell = {}
			if (!cell.options) cell.options = {}

			// DESIGN: Cells are henceforth {`text`: `opts`:}
			let lines: string[] = []

			// 1: Capture some table options for use in other functions
			cell.options.lineWeight = opts.lineWeight

			// 2: Create a cell object for each table column
			currRow.push({ text: '', options: cell.options })

			// 3: Parse cell contents into lines (**MAGIC HAPPENSS HERE**)
			lines = parseTextToLines(cell, opts.colW[iCell] / ONEPT)
			arrCellsLines.push(lines)
			///if (opts.debug) console.log('Cell:'+iCell+' - lines:'+lines.length);

			// 4: Keep track of max line count within all row cells
			if (lines.length > intMaxLineCnt) {
				intMaxLineCnt = lines.length
				intMaxColIdx = iCell
			}

			let lineHeight = inch2Emu(((cell.options.fontSize || DEF_FONT_SIZE) * LINEH_MODIFIER) / 100)
			// NOTE: Exempt cells with `rowspan` from increasing lineHeight (or we could create a new slide when unecessary!)
			if (cell.options && cell.options.rowspan) lineHeight = 0

			// 5: Add cell margins to lineHeight (if any)
			if (cell.options.margin) {
				if (cell.options.margin[0]) lineHeight += (cell.options.margin[0] * ONEPT) / intMaxLineCnt
				if (cell.options.margin[2]) lineHeight += (cell.options.margin[2] * ONEPT) / intMaxLineCnt
			}

			// 6: Add to array
			arrCellsLineHeights.push(Math.round(lineHeight))
		})

		// D: AUTO-PAGING: Add text one-line-a-time to this row's cells until: lines are exhausted OR table H limit is hit
		for (var idx = 0; idx < intMaxLineCnt; idx++) {
			// 1: Add the current line to cell
			for (var col = 0; col < arrCellsLines.length; col++) {
				// A: Commit this slide to Presenation if table Height limit is hit
				if (emuTabCurrH + arrCellsLineHeights[intMaxColIdx] > emuSlideTabH) {
					if (opts.debug) console.log('--------------- New Slide Created ---------------')
					if (opts.debug)
						console.log(
							' (calc) ' + (emuTabCurrH / EMU).toFixed(1) + '+' + (arrCellsLineHeights[intMaxColIdx] / EMU).toFixed(1) + ' > ' + (emuSlideTabH / EMU).toFixed(1)
						)
					if (opts.debug) console.log('--------------- New Slide Created ---------------')
					// 1: Add the current row to table
					// NOTE: Edge cases can occur where we create a new slide only to have no more lines
					// ....: and then a blank row sits at the bottom of a table!
					// ....: Hence, we verify all cells have text before adding this final row.
					jQuery.each(currRow, (_idx, cell) => {
						if (cell.text.length > 0) {
							// IMPORTANT: use jQuery extend (deep copy) or cell will mutate!!
							arrRows.push(jQuery.extend(true, [], currRow))
							return false // break out of .each loop
						}
					})
					// 2: Add new Slide with current array of table rows
					arrObjSlides.push(jQuery.extend(true, [], arrRows))
					// 3: Empty rows for new Slide
					arrRows.length = 0
					// 4: Reset current table height for new Slide
					emuTabCurrH = 0 // This row's emuRowH w/b added below
					// 5: Empty current row's text (continue adding lines where we left off below)
					jQuery.each(currRow, (_idx, cell) => {
						cell.text = ''
					})
					// 6: Auto-Paging Options: addHeaderToEach
					if (opts.addHeaderToEach && opts._arrObjTabHeadRows) arrRows = arrRows.concat(opts._arrObjTabHeadRows)
				}

				// B: Add next line of text to this cell
				if (arrCellsLines[col][idx]) currRow[col].text += arrCellsLines[col][idx]
			}

			// 2: Add this new rows H to overall (use cell with the most lines as the determiner for overall row Height)
			emuTabCurrH += arrCellsLineHeights[intMaxColIdx]
		}

		if (opts.debug) console.log('-> ' + iRow + ' row done!')
		if (opts.debug) console.log('-> emuTabCurrH (in) . = ' + (emuTabCurrH / EMU).toFixed(1))

		// E: Flush row buffer - Add the current row to table, then truncate row cell array
		// IMPORTANT: use jQuery extend (deep copy) or cell will mutate!!
		if (currRow.length) arrRows.push(jQuery.extend(true, [], currRow))
		currRow.length = 0
	})

	// STEP 4-2: Flush final row buffer to slide
	arrObjSlides.push(jQuery.extend(true, [], arrRows))

	if (opts.debug) {
		console.log('arrObjSlides count = ' + arrObjSlides.length)
		console.log(arrObjSlides)
	}

	return arrObjSlides
}

/**
 * Reproduces an HTML table as a PowerPoint table - including column widths, style, etc. - creates 1 or more slides as needed
 * @param {string} `tabEleId` - HTMLElementID of the table
 * @param {ITableToSlidesOpts} `inOpts` - array of options (e.g.: tabsize)
 */
export function genTableToSlides(pptx: PptxGenJS, tabEleId: string, options: ITableToSlidesOpts = {}, masterSlide: ISlideLayout) {
	let opts = options || {}
	opts.slideMargin = opts.slideMargin || opts.slideMargin == 0 ? opts.slideMargin : 0.5
	let emuSlideTabW = opts.w || pptx.presLayout().width
	let arrObjTabHeadRows: [ITableToSlidesCell[]?] = []
	let arrObjTabBodyRows: [ITableToSlidesCell[]?] = []
	let arrObjTabFootRows: [ITableToSlidesCell[]?] = []
	let arrColW: number[] = []
	let arrTabColW: number[] = []
	let arrInchMargins = [0.5, 0.5, 0.5, 0.5] // TRBL-style
	let arrTableParts = ['thead', 'tbody', 'tfoot']
	let intTabW = 0

	// REALITY-CHECK:
	if (!document.getElementById(tabEleId)) throw 'Table "' + tabEleId + '" does not exist!'

	// Set margins
	if (masterSlide && masterSlide.margin) {
		if (Array.isArray(masterSlide.margin)) arrInchMargins = masterSlide.margin
		else if (!isNaN(masterSlide.margin)) arrInchMargins = [masterSlide.margin, masterSlide.margin, masterSlide.margin, masterSlide.margin]
		opts.slideMargin = arrInchMargins
	} else if (opts && opts.slideMargin) {
		if (Array.isArray(opts.slideMargin)) arrInchMargins = opts.slideMargin
		else if (!isNaN(opts.slideMargin)) arrInchMargins = [opts.slideMargin, opts.slideMargin, opts.slideMargin, opts.slideMargin]
	}
	emuSlideTabW = (opts.w ? inch2Emu(opts.w) : pptx.presLayout().width) - inch2Emu(arrInchMargins[1] + arrInchMargins[3])

	// STEP 1: Grab table col widths
	//arrTableParts.forEach((part, _idx) => { // NO! CAREFUL! We need to break out of loop using "return false" - forEach break col sizing badly
	jQuery.each(arrTableParts, (_idx, part) => {
		if (jQuery('#' + tabEleId + ' > ' + part + ' > tr').length > 0) {
			jQuery('#' + tabEleId + ' > ' + part + ' > tr:first-child')
				.find('> th, > td')
				.each((idx, cell) => {
					// FIXME: This is a hack - guessing at col widths when colspan
					if (jQuery(cell).attr('colspan')) {
						for (var idx = 0; idx < Number(jQuery(cell).attr('colspan')); idx++) {
							arrTabColW.push(Math.round(jQuery(cell).outerWidth() / Number(jQuery(cell).attr('colspan'))))
						}
					} else {
						arrTabColW.push(jQuery(cell).outerWidth())
					}
				})
			return false // break out of .each loop
		}
	})
	arrTabColW.forEach((colW, _idx) => {
		intTabW += colW
	})

	// STEP 2: Calc/Set column widths by using same column width percent from HTML table
	arrTabColW.forEach((colW, idx) => {
		let intCalcWidth = Number(((emuSlideTabW * ((colW / intTabW) * 100)) / 100 / EMU).toFixed(2))
		let intMinWidth = jQuery('#' + tabEleId + ' thead tr:first-child th:nth-child(' + (idx + 1) + ')').data('pptx-min-width')
		let intSetWidth = jQuery('#' + tabEleId + ' thead tr:first-child th:nth-child(' + (idx + 1) + ')').data('pptx-width')
		arrColW.push(intSetWidth ? intSetWidth : intMinWidth > intCalcWidth ? intMinWidth : intCalcWidth)
	})

	// STEP 3: Iterate over each table element and create data arrays (text and opts)
	// NOTE: We create 3 arrays instead of one so we can loop over body then show header/footer rows on first and last page
	arrTableParts.forEach((part, _idx) => {
		jQuery('#' + tabEleId + ' > ' + part + ' > tr').each((_idx, row) => {
			let arrObjTabCells = []
			jQuery(row)
				.find('> th, > td')
				.each((_idx, cell) => {
					// A: Get RGB text/bkgd colors
					let arrRGB1 = []
					let arrRGB2 = []
					arrRGB1 = jQuery(cell)
						.css('color')
						.replace(/\s+/gi, '')
						.replace('rgba(', '')
						.replace('rgb(', '')
						.replace(')', '')
						.split(',')
					arrRGB2 = jQuery(cell)
						.css('background-color')
						.replace(/\s+/gi, '')
						.replace('rgba(', '')
						.replace('rgb(', '')
						.replace(')', '')
						.split(',')
					// ISSUE#57: jQuery default is this rgba value of below giving unstyled tables a black bkgd, so use white instead
					// (FYI: if cell has `background:#000000` jQuery returns 'rgb(0, 0, 0)', so this soln is pretty solid)
					if (jQuery(cell).css('background-color') == 'rgba(0, 0, 0, 0)' || jQuery(cell).css('background-color') == 'transparent') arrRGB2 = [255, 255, 255]

					// B: Create option object
					let cellOpts = {
						fontSize: jQuery(cell)
							.css('font-size')
							.replace(/[a-z]/gi, ''),
						bold: jQuery(cell).css('font-weight') == 'bold' || Number(jQuery(cell).css('font-weight')) >= 500 ? true : false,
						color: rgbToHex(Number(arrRGB1[0]), Number(arrRGB1[1]), Number(arrRGB1[2])),
						fill: rgbToHex(Number(arrRGB2[0]), Number(arrRGB2[1]), Number(arrRGB2[2])),
						align: null,
						border: null,
						margin: null,
						colspan: null,
						rowspan: null,
						valign: null,
					}
					if (['left', 'center', 'right', 'start', 'end'].indexOf(jQuery(cell).css('text-align')) > -1)
						cellOpts.align = jQuery(cell)
							.css('text-align')
							.replace('start', 'left')
							.replace('end', 'right')
					if (['top', 'middle', 'bottom'].indexOf(jQuery(cell).css('vertical-align')) > -1) cellOpts.valign = jQuery(cell).css('vertical-align')

					// C: Add padding [margin] (if any)
					// NOTE: Margins translate: px->pt 1:1 (e.g.: a 20px padded cell looks the same in PPTX as 20pt Text Inset/Padding)
					if (jQuery(cell).css('padding-left')) {
						cellOpts.margin = []
						jQuery.each(['padding-top', 'padding-right', 'padding-bottom', 'padding-left'], (_idx, val) => {
							cellOpts.margin.push(
								Math.round(
									Number(
										jQuery(cell)
											.css(val)
											.replace(/\D/gi, '')
									)
								)
							)
						})
					}

					// D: Add colspan/rowspan (if any)
					if (jQuery(cell).attr('colspan')) cellOpts.colspan = jQuery(cell).attr('colspan')
					if (jQuery(cell).attr('rowspan')) cellOpts.rowspan = jQuery(cell).attr('rowspan')

					// E: Add border (if any)
					if (
						jQuery(cell).css('border-top-width') ||
						jQuery(cell).css('border-right-width') ||
						jQuery(cell).css('border-bottom-width') ||
						jQuery(cell).css('border-left-width')
					) {
						cellOpts.border = []
						jQuery.each(['top', 'right', 'bottom', 'left'], (_idx, val) => {
							var intBorderW = Math.round(
								Number(
									jQuery(cell)
										.css('border-' + val + '-width')
										.replace('px', '')
								)
							)
							var arrRGB = []
							arrRGB = jQuery(cell)
								.css('border-' + val + '-color')
								.replace(/\s+/gi, '')
								.replace('rgba(', '')
								.replace('rgb(', '')
								.replace(')', '')
								.split(',')
							var strBorderC = rgbToHex(Number(arrRGB[0]), Number(arrRGB[1]), Number(arrRGB[2]))
							cellOpts.border.push({ pt: intBorderW, color: strBorderC })
						})
					}

					// F: Massage cell text so we honor linebreak tag as a line break during line parsing
					let $cell2 = jQuery(cell).clone()
					$cell2.html(
						jQuery(cell)
							.html()
							.replace(/<br[^>]*>/gi, '\n')
					)

					// LAST: Add cell
					arrObjTabCells.push({
						text: $cell2.text().trim(),
						options: cellOpts,
					})
				})
			switch (part) {
				case 'thead':
					arrObjTabHeadRows.push(arrObjTabCells)
					break
				case 'tbody':
					arrObjTabBodyRows.push(arrObjTabCells)
					break
				case 'tfoot':
					arrObjTabFootRows.push(arrObjTabCells)
					break
				default:
			}
		})
	})

	// STEP 5: Break table into Slides as needed
	// Pass head-rows as there is an option to add to each table and the parse func needs this data to fulfill that option
	opts._arrObjTabHeadRows = arrObjTabHeadRows || null
	opts.colW = arrColW

	getSlidesForTableRows(arrObjTabHeadRows.concat(arrObjTabBodyRows).concat(arrObjTabFootRows) as [ITableToSlidesCell[]], opts, pptx.presLayout(), masterSlide).forEach(
		(arrTabRows, idx) => {
			// A: Create new Slide
			let newSlide = pptx.addSlide(opts.masterSlideName || null)

			// B: DESIGN: Reset `y` to `newPageStartY` or margin after first Slide (ISSUE#43, ISSUE#47, ISSUE#48)
			if (idx == 0) opts.y = opts.y || arrInchMargins[0]
			if (idx > 0) opts.y = opts.newSlideStartY || arrInchMargins[0]
			if (opts.debug) console.log('opts.newPageStartY:' + opts.newSlideStartY + ' / arrInchMargins[0]:' + arrInchMargins[0] + ' => opts.y = ' + opts.y)

			// C: Add table to Slide
			newSlide.addTable(arrTabRows, { x: opts.x || arrInchMargins[3], y: opts.y, w: emuSlideTabW / EMU, colW: arrColW, autoPage: false })

			// D: Add any additional objects
			if (opts.addImage) newSlide.addImage({ path: opts.addImage.url, x: opts.addImage.x, y: opts.addImage.y, w: opts.addImage.w, h: opts.addImage.h })
			if (opts.addShape) newSlide.addShape(opts.addShape.shape, opts.addShape.opts || {})
			if (opts.addTable) newSlide.addTable(opts.addTable.rows, opts.addTable.opts || {})
			if (opts.addText) newSlide.addText(opts.addText.text, opts.addText.opts || {})
		}
	)
}